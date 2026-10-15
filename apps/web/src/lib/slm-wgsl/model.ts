/**
 * sarashina2.2-0.5b (Llama 系 decoder、int4 g32) の WebGPU 推論本体。Worker 内で使う。
 *
 * - 重みは weights.ts が part ごとにストリームし、tensor ごとの GPU buffer へ直接書く (CPU に全体を持たない)。
 * - KV cache は f16 で GPU 常駐 (maxCtx ぶん事前確保)。prefill は PREFILL_CHUNK トークンずつ。
 * - 最後の位置の logits から GPU で top-K を取り、CPU では K 個だけで温度・top-p サンプリングする。
 * 試作 (~/.pi/slm-wgsl/web/src/model.ts) の Llama 経路だけを移植した。
 */
import { attentionWgsl, embedWgsl, matmulWgsl, qkprepWgsl, rmsnormWgsl, swigluWgsl, topkWgsl, type AttnDims } from './kernels';
import { BUFFER_USAGE, MAP_MODE_READ } from '../cognitive-wgsl/gpu-flags';
import { streamWeights, type SlmHeader, type WeightSegment } from './weights';

const ST = BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC;
const UNIFORM = BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST;
export const TOPK = 40;
const TOPK_BLOCK = 4096;
/** 1 回の GPU 実行で prefill するトークン数 (活性化 buffer の容量)。 */
export const PREFILL_CHUNK = 64;
const PREFILL_TT = 8;
/** 1 tensor の buffer 上限。これを超える tensor は行方向に分割する。 */
const MAX_TENSOR_BUFFER = 128 * 1024 * 1024;

export class WebGpuUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WebGpuUnsupportedError';
  }
}

interface Q4Split { buf: GPUBuffer; rowBase: number; rows: number; qBytes: number }
interface Q4Tensor { kind: 'q4'; N: number; K: number; splits: Q4Split[] }
interface F32Tensor { kind: 'f32'; buf: GPUBuffer }
type Tensor = Q4Tensor | F32Tensor;

type BindKind = 'r' | 'w' | 'u';
interface Step { pipe: GPUComputePipeline; bind: GPUBindGroup; grid: (T: number) => [number, number] }

export interface TopK { ids: Uint32Array; vals: Float32Array }
export interface SampleOptions { temperature: number; topP: number }

export class SlmModel {
  private owned: GPUBuffer[] = [];
  private tensors = new Map<string, Tensor>();
  private layouts = new Map<string, GPUBindGroupLayout>();
  private pipes = new Map<string, GPUComputePipeline>();
  private prefillSteps: Step[] = [];
  private decodeSteps: Step[] = [];
  private headSteps: Step[] = [];
  private act: Record<string, GPUBuffer> = {};
  private dyn!: GPUBuffer;
  private gpuError: string | null = null;
  private pos = 0;
  /** GPU device を失った (iOS のバックグラウンド化など) 時に resolve する。呼び出し側は作り直す。 */
  readonly lost: Promise<GPUDeviceLostInfo>;

  private constructor(private device: GPUDevice, readonly header: SlmHeader) {
    this.lost = device.lost;
    device.onuncapturederror = (ev) => {
      this.gpuError ??= ev.error.message || 'GPU error';
      console.error('[slm] uncaptured GPU error', ev.error);
    };
  }

  /** 一度でも捕捉されない GPU error が出たら結果を信用しない (呼び出し側が作り直す)。 */
  get broken(): boolean { return this.gpuError !== null; }

  static async create(baseUrl: string, header: SlmHeader, onPartDone: (done: number, total: number) => void): Promise<SlmModel> {
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
    if (!gpu) throw new WebGpuUnsupportedError('navigator.gpu is not available');
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new WebGpuUnsupportedError('no WebGPU adapter');
    const l = adapter.limits;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
        maxBufferSize: l.maxBufferSize,
        maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize,
      },
    });
    const model = new SlmModel(device, header);
    try {
      device.pushErrorScope('out-of-memory');
      device.pushErrorScope('validation');
      let err: unknown = null;
      try {
        const maxB = Math.min(l.maxStorageBufferBindingSize, l.maxBufferSize, MAX_TENSOR_BUFFER);
        await streamWeights(device, baseUrl, header, model.allocateWeights(maxB), onPartDone);
        model.allocateActivations();
        model.buildSteps();
        await model.forwardTopk([1, 2, 3]); // warmup (pipeline compile)
        model.pos = 0;
        await device.queue.onSubmittedWorkDone();
      } catch (e) { err = e; }
      const v = await device.popErrorScope();
      const o = await device.popErrorScope();
      if (err) throw err;
      const g = o ?? v ?? (model.gpuError ? { message: model.gpuError } : null);
      if (g) throw new Error(`GPU setup failed (${o ? 'out-of-memory' : 'validation'}): ${g.message}`);
      return model;
    } catch (e) {
      model.dispose();
      throw e;
    }
  }

  private buffer(label: string, size: number, usage: number = ST): GPUBuffer {
    const b = this.device.createBuffer({ label: `slm:${label}`, size: Math.max(16, Math.ceil(size / 4) * 4), usage });
    this.owned.push(b);
    return b;
  }

  /** tensor ごとの GPU buffer を作り、ファイル上の byte 範囲 → (buffer, offset) の対応をファイル順で返す。 */
  private allocateWeights(maxBuffer: number): WeightSegment[] {
    const segs: WeightSegment[] = [];
    for (const t of this.header.tensors) {
      if (t.kind === 'f32') {
        const buf = this.buffer(t.name, t.bytes!);
        this.tensors.set(t.name, { kind: 'f32', buf });
        segs.push({ start: t.offset, end: t.offset + t.bytes!, buf, off: 0 });
        continue;
      }
      const [N, K] = t.shape as [number, number];
      const rowQ = K / 2;
      const rowS = K / 16; // 32 要素ごとに f16 1 個
      const rowsPer = Math.max(1, Math.floor(maxBuffer / (rowQ + rowS) / 64) * 64);
      const splits: Q4Split[] = [];
      for (let r = 0; r < N; r += rowsPer) {
        const rows = Math.min(rowsPer, N - r);
        const buf = this.buffer(`${t.name}#${splits.length}`, rows * (rowQ + rowS));
        splits.push({ buf, rowBase: r, rows, qBytes: rows * rowQ });
        segs.push({ start: t.offset + r * rowQ, end: t.offset + (r + rows) * rowQ, buf, off: 0 });
      }
      const sBase = t.offset + t.qBytes!;
      for (const s of splits) {
        segs.push({ start: sBase + s.rowBase * rowS, end: sBase + (s.rowBase + s.rows) * rowS, buf: s.buf, off: s.qBytes });
      }
      this.tensors.set(t.name, { kind: 'q4', N, K, splits });
    }
    return segs.sort((a, b) => a.start - b.start);
  }

  private get attn(): AttnDims {
    const c = this.header.config;
    return { heads: c.heads, kvHeads: c.kvHeads, hd: c.headDim, theta: c.ropeTheta, maxCtx: c.maxCtx };
  }

  private uniform(words: number[]): GPUBuffer {
    const b = this.buffer('uniform', 32, UNIFORM);
    const u = new Uint32Array(8);
    words.forEach((w, i) => { u[i] = w; });
    this.device.queue.writeBuffer(b, 0, u);
    return b;
  }

  private allocateActivations() {
    const c = this.header.config;
    const T = PREFILL_CHUNK;
    const attnIn = (c.heads + 2 * c.kvHeads) * c.headDim;
    const nCand = Math.ceil(c.vocab / TOPK_BLOCK) * TOPK;
    const a = this.act;
    a.ids = this.buffer('ids', T * 4);
    a.x = this.buffer('x', T * c.hidden * 4);
    a.xn = this.buffer('xn', T * c.hidden * 4);
    a.big = this.buffer('big', T * Math.max(attnIn, 2 * c.inter) * 4);
    a.mid = this.buffer('mid', T * Math.max(c.inter, c.heads * c.headDim) * 4);
    a.qb = this.buffer('qb', T * c.heads * c.headDim * 4);
    a.last = this.buffer('last', c.hidden * 4);
    a.logits = this.buffer('logits', c.vocab * 4);
    a.candV = this.buffer('candV', nCand * 4);
    a.candI = this.buffer('candI', nCand * 4);
    a.topV = this.buffer('topV', TOPK * 4);
    a.topI = this.buffer('topI', TOPK * 4);
    a.dummy = this.buffer('dummy', 16);
    a.readback = this.buffer('readback', TOPK * 8, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST);
    a.dynOne = this.uniform([1, 0, 0, 0]);
    a.vocabN = this.uniform([c.vocab]);
    a.candN = this.uniform([nCand]);
    this.dyn = this.buffer('dyn', 16, UNIFORM);
    const kv = c.maxCtx * c.kvHeads * c.headDim * 2;
    for (let i = 0; i < c.layers.length; i++) {
      a[`k${i}`] = this.buffer(`k${i}`, kv);
      a[`v${i}`] = this.buffer(`v${i}`, kv);
    }
  }

  private layout(kinds: BindKind[]): GPUBindGroupLayout {
    const key = kinds.join('');
    let l = this.layouts.get(key);
    if (!l) {
      l = this.device.createBindGroupLayout({
        entries: kinds.map((k, i) => ({
          binding: i,
          visibility: 4, // GPUShaderStage.COMPUTE
          buffer: { type: k === 'u' ? 'uniform' : k === 'r' ? 'read-only-storage' : 'storage' },
        })),
      });
      this.layouts.set(key, l);
    }
    return l;
  }

  private pipeline(key: string, code: string, kinds: BindKind[]): GPUComputePipeline {
    let p = this.pipes.get(key);
    if (!p) {
      const module = this.device.createShaderModule({ code, label: `slm:${key}` });
      p = this.device.createComputePipeline({
        label: `slm:${key}`,
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.layout(kinds)] }),
        compute: { module, entryPoint: 'main' },
      });
      this.pipes.set(key, p);
    }
    return p;
  }

  private bind(kinds: BindKind[], bufs: GPUBuffer[]): GPUBindGroup {
    return this.device.createBindGroup({ layout: this.layout(kinds), entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })) });
  }

  /** q4 tensor 1 本の matmul (split ごとに 1 step)。 */
  private mm(name: string, x: GPUBuffer, out: GPUBuffer, acc: boolean, xStride: number, outStride: number, dyn: GPUBuffer) {
    const t = this.tensors.get(name) as Q4Tensor;
    const kinds: BindKind[] = ['r', 'r', 'w', 'u', 'u'];
    const res = { prefill: [] as Step[], decode: [] as Step[] };
    for (const s of t.splits) {
      const p = this.uniform([s.rows, t.K, s.qBytes / 4, s.rowBase, outStride, xStride, 0, 0]);
      const bind = this.bind(kinds, [s.buf, x, out, p, dyn]);
      res.decode.push({ pipe: this.pipeline(`mm1${acc}`, matmulWgsl(1, acc), kinds), bind, grid: () => [Math.ceil(s.rows / 8), 1] });
      res.prefill.push({
        pipe: this.pipeline(`mm${PREFILL_TT}${acc}`, matmulWgsl(PREFILL_TT, acc), kinds),
        bind,
        grid: (T) => [Math.ceil(s.rows / 8), Math.ceil(T / PREFILL_TT)],
      });
    }
    return res;
  }

  private buildSteps() {
    const c = this.header.config;
    const a = this.act as Required<Record<string, GPUBuffer>>;
    const d = this.dyn;
    const H = c.hidden;
    const attn = this.attn;
    const attnIn = (c.heads + 2 * c.kvHeads) * c.headDim;
    const both = (s: Step) => { this.prefillSteps.push(s); this.decodeSteps.push(s); };
    const addMM = (r: { prefill: Step[]; decode: Step[] }) => { this.prefillSteps.push(...r.prefill); this.decodeSteps.push(...r.decode); };
    const f32 = (n: string) => (this.tensors.get(n) as F32Tensor).buf;
    const embK: BindKind[] = ['r', 'r', 'w', 'u', 'u'];
    for (const s of (this.tensors.get('embed') as Q4Tensor).splits) {
      const p = this.uniform([s.rows, s.rowBase, s.qBytes / 4, 0]);
      both({ pipe: this.pipeline('embed', embedWgsl(H), embK), bind: this.bind(embK, [s.buf, a.ids!, a.x!, p, d]), grid: (T) => [T, 1] });
    }
    const normK: BindKind[] = ['r', 'r', 'w', 'u'];
    const norm = (w: GPUBuffer, x: GPUBuffer, o: GPUBuffer, dyn = d): Step =>
      ({ pipe: this.pipeline('rms', rmsnormWgsl(H, c.eps), normK), bind: this.bind(normK, [x, w, o, dyn]), grid: (T) => [T, 1] });
    for (let i = 0; i < c.layers.length; i++) {
      const L = `l${i}.`;
      both(norm(f32(L + 'in_norm'), a.x!, a.xn!));
      addMM(this.mm(L + 'attn_in', a.xn!, a.big!, false, H, attnIn, d));
      const qk: BindKind[] = ['r', 'w', 'w', 'w', 'u'];
      both({ pipe: this.pipeline('qkprep', qkprepWgsl(attn), qk), bind: this.bind(qk, [a.big!, a.qb!, a[`k${i}`]!, a[`v${i}`]!, d]), grid: (T) => [c.heads + 2 * c.kvHeads, T] });
      const at: BindKind[] = ['r', 'r', 'r', 'w', 'u'];
      both({ pipe: this.pipeline('attn', attentionWgsl(attn), at), bind: this.bind(at, [a.qb!, a[`k${i}`]!, a[`v${i}`]!, a.mid!, d]), grid: (T) => [c.heads, T] });
      addMM(this.mm(L + 'attn_out', a.mid!, a.x!, true, c.heads * c.headDim, H, d));
      both(norm(f32(L + 'post_norm'), a.x!, a.xn!));
      addMM(this.mm(L + 'mlp_in', a.xn!, a.big!, false, H, 2 * c.inter, d));
      const sw: BindKind[] = ['r', 'w', 'u'];
      both({ pipe: this.pipeline('swiglu', swigluWgsl(c.inter), sw), bind: this.bind(sw, [a.big!, a.mid!, d]), grid: (T) => [Math.ceil(c.inter / 256), T] });
      addMM(this.mm(L + 'mlp_out', a.mid!, a.x!, true, c.inter, H, d));
    }
    // head: 最後の行だけ final norm → LM head → top-K (2 段)
    this.headSteps.push(norm(f32('final_norm'), a.last!, a.xn!, a.dynOne!));
    this.headSteps.push(...this.mm('lm_head', a.xn!, a.logits!, false, H, c.vocab, a.dynOne!).decode);
    const tk: BindKind[] = ['w', 'r', 'w', 'w', 'u'];
    const nCand = Math.ceil(c.vocab / TOPK_BLOCK) * TOPK;
    this.headSteps.push({ pipe: this.pipeline('topk1', topkWgsl(TOPK, TOPK_BLOCK, false), tk), bind: this.bind(tk, [a.logits!, a.dummy!, a.candV!, a.candI!, a.vocabN!]), grid: () => [Math.ceil(c.vocab / TOPK_BLOCK), 1] });
    this.headSteps.push({ pipe: this.pipeline('topk2', topkWgsl(TOPK, nCand, true), tk), bind: this.bind(tk, [a.candV!, a.candI!, a.topV!, a.topI!, a.candN!]), grid: () => [1, 1] });
  }

  /** 現在位置から ids を流し、最後のトークンの logits の top-K を返す。 */
  async forwardTopk(ids: number[]): Promise<TopK> {
    if (this.gpuError) throw new Error(`GPU error: ${this.gpuError}`);
    const c = this.header.config;
    const a = this.act;
    if (ids.length === 0) throw new Error('empty input');
    if (this.pos + ids.length > c.maxCtx) throw new Error(`context full (${c.maxCtx})`);
    for (let s = 0; s < ids.length; s += PREFILL_CHUNK) {
      const chunk = ids.slice(s, s + PREFILL_CHUNK);
      const T = chunk.length;
      this.device.queue.writeBuffer(a.ids!, 0, new Uint32Array(chunk));
      this.device.queue.writeBuffer(this.dyn, 0, new Uint32Array([T, this.pos, 0, 0]));
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      for (const st of T === 1 ? this.decodeSteps : this.prefillSteps) {
        pass.setPipeline(st.pipe);
        pass.setBindGroup(0, st.bind);
        const [gx, gy] = st.grid(T);
        pass.dispatchWorkgroups(gx, gy);
      }
      pass.end();
      this.pos += T;
      if (s + PREFILL_CHUNK < ids.length) {
        this.device.queue.submit([enc.finish()]);
        continue;
      }
      enc.copyBufferToBuffer(a.x!, (T - 1) * c.hidden * 4, a.last!, 0, c.hidden * 4);
      const hp = enc.beginComputePass();
      for (const st of this.headSteps) {
        hp.setPipeline(st.pipe);
        hp.setBindGroup(0, st.bind);
        const [gx, gy] = st.grid(1);
        hp.dispatchWorkgroups(gx, gy);
      }
      hp.end();
      enc.copyBufferToBuffer(a.topV!, 0, a.readback!, 0, TOPK * 4);
      enc.copyBufferToBuffer(a.topI!, 0, a.readback!, TOPK * 4, TOPK * 4);
      this.device.queue.submit([enc.finish()]);
      await a.readback!.mapAsync(MAP_MODE_READ);
      const buf = a.readback!.getMappedRange().slice(0);
      a.readback!.unmap();
      if (this.gpuError) throw new Error(`GPU error: ${this.gpuError}`);
      return { vals: new Float32Array(buf, 0, TOPK), ids: new Uint32Array(buf, TOPK * 4, TOPK) };
    }
    throw new Error('unreachable');
  }

  /**
   * prompt を流して 1 トークンずつ生成する。onToken が false を返すか EOS / maxNew / ctx 上限で止まる。
   * 返り値は生成したトークン列 (EOS は含めない)。
   */
  async generate(prompt: number[], maxNew: number, sampleOpts: SampleOptions, onToken: (id: number) => boolean): Promise<number[]> {
    const c = this.header.config;
    this.pos = 0; // KV cache は位置で上書きするので pos を戻すだけでよい
    const out: number[] = [];
    let top = await this.forwardTopk(prompt);
    for (;;) {
      const next = sampleTopK(top, sampleOpts, Math.random);
      if (c.eos.includes(next)) break;
      out.push(next);
      if (!onToken(next) || out.length >= maxNew || this.pos >= c.maxCtx) break;
      top = await this.forwardTopk([next]);
    }
    return out;
  }

  dispose() {
    for (const b of this.owned) {
      try { b.destroy(); } catch { /* no-op */ }
    }
    this.owned = [];
    this.device.destroy();
  }
}

/** top-K の logits から温度 + top-p でサンプリングする。温度 0 は greedy。 */
export function sampleTopK(top: TopK, o: SampleOptions, rand: () => number): number {
  if (o.temperature <= 0) return top.ids[0]!;
  const n = top.ids.length;
  const m = top.vals[0]!;
  const p = new Array<number>(n);
  let s = 0;
  for (let i = 0; i < n; i++) { p[i] = Math.exp((top.vals[i]! - m) / o.temperature); s += p[i]!; }
  let cum = 0;
  let cut = n;
  for (let i = 0; i < n; i++) { cum += p[i]! / s; if (cum >= o.topP) { cut = i + 1; break; } }
  let z = 0;
  for (let i = 0; i < cut; i++) z += p[i]!;
  let r = rand() * z;
  for (let i = 0; i < cut; i++) { r -= p[i]!; if (r <= 0) return top.ids[i]!; }
  return top.ids[cut - 1]!;
}
