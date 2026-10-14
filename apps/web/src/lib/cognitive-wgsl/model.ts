/**
 * cognitive-small の WebGPU 推論本体。GPU buffer と pipeline は create() で 1 回だけ作り、
 * run() のたびに使い回す。dispose() で全 buffer を destroy して device を破棄する。
 *
 * 1 回の run() は「packed」バッチ (系列を連結した最大 MAX_BATCH_TOKENS トークン) を処理し、
 * 系列ごとの 9 クラス logits を返す。
 */
import {
  ATTENTION_WGSL, CLASSIFIER_WGSL, CLS_GATHER_WGSL, EMBED_WGSL, GEGLU_WGSL, HEAD_DIM, HEADS, HIDDEN,
  INTERMEDIATE, LAYER_NORM_WGSL, LINEAR_WGSL, MAX_SEQ_TOKENS, ROPE_WGSL,
} from './kernels';
import { BUFFER_USAGE, MAP_MODE_READ } from './gpu-flags';
import { loadWeights, type GpuWeights, type WeightProgress } from './weights';
import { buildRopeTables, packSequences } from './packing';

/** 1 回の GPU 実行で扱う最大トークン数 (活性化 buffer の容量、約 18MB)。1 系列の上限 MAX_SEQ_TOKENS と同じ。 */
export const MAX_BATCH_TOKENS = MAX_SEQ_TOKENS;
/** 1 回の GPU 実行で扱う最大系列数。 */
export const MAX_BATCH_SEQS = 64;
const LAYERS = 10;
const CLASSES = 9;
const GLOBAL_EVERY = 3;
const LOCAL_ROPE_THETA = 10000;
const GLOBAL_ROPE_THETA = 160000;

const STORAGE = BUFFER_USAGE.STORAGE | BUFFER_USAGE.COPY_DST | BUFFER_USAGE.COPY_SRC;

export class WebGpuUnsupportedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WebGpuUnsupportedError';
  }
}

interface Step {
  pipeline: GPUComputePipeline;
  bind: GPUBindGroup;
  /** トークン数 T と系列数 S から dispatch サイズを決める。 */
  grid: (tokens: number, seqs: number) => [number, number];
}

export class CognitiveWgslModel {
  private steps: Step[] = [];
  /** GPU device を失った (iOS のバックグラウンド化など) 時に resolve する。呼び出し側は作り直す。 */
  readonly lost: Promise<unknown>;
  private constructor(
    private device: GPUDevice,
    private weights: GpuWeights,
    private owned: GPUBuffer[],
    private io: { tok: GPUBuffer; seqStart: GPUBuffer; dims: GPUBuffer; logits: GPUBuffer; readback: GPUBuffer },
  ) {
    this.lost = device.lost;
  }

  static async create(modelUrl: string, onProgress?: WeightProgress): Promise<CognitiveWgslModel> {
    const gpu = (globalThis.navigator as Navigator | undefined)?.gpu;
    if (!gpu) throw new WebGpuUnsupportedError('navigator.gpu is not available');
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new WebGpuUnsupportedError('no WebGPU adapter');
    const device = await adapter.requestDevice();
    let weights: GpuWeights | null = null;
    try {
      weights = (await loadWeights(device, modelUrl, onProgress)).weights;
      const model = CognitiveWgslModel.allocate(device, weights);
      model.buildSteps();
      return model;
    } catch (e) {
      if (weights) for (const b of weights.values()) b.destroy();
      device.destroy();
      throw e;
    }
  }

  private static allocate(device: GPUDevice, weights: GpuWeights): CognitiveWgslModel {
    const owned: GPUBuffer[] = [];
    const buf = (label: string, size: number, usage = STORAGE) => {
      const b = device.createBuffer({ label: `cognitive:${label}`, size, usage });
      owned.push(b);
      return b;
    };
    const T = MAX_BATCH_TOKENS;
    const S = MAX_BATCH_SEQS;
    buf('x', T * HIDDEN * 4);
    buf('h', T * HIDDEN * 4);
    buf('qkv', T * 3 * HIDDEN * 4);
    buf('attn', T * HIDDEN * 4);
    buf('u', T * 2 * INTERMEDIATE * 4);
    buf('g', T * INTERMEDIATE * 4);
    buf('cls1', S * HIDDEN * 4);
    buf('cls2', S * HIDDEN * 4);
    const local = buildRopeTables(MAX_SEQ_TOKENS, HEAD_DIM, LOCAL_ROPE_THETA);
    const global = buildRopeTables(MAX_SEQ_TOKENS, HEAD_DIM, GLOBAL_ROPE_THETA);
    for (const [name, data] of [['cosL', local.cos], ['sinL', local.sin], ['cosG', global.cos], ['sinG', global.sin]] as const) {
      device.queue.writeBuffer(buf(name, data.byteLength), 0, data);
    }
    const io = {
      tok: buf('tok', T * 16),
      seqStart: buf('seqStart', S * 4),
      dims: buf('dims', 16, BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST),
      logits: buf('logits', S * CLASSES * 4),
      readback: buf('readback', S * CLASSES * 4, BUFFER_USAGE.MAP_READ | BUFFER_USAGE.COPY_DST),
    };
    return new CognitiveWgslModel(device, weights, owned, io);
  }

  private named(label: string): GPUBuffer {
    const b = this.owned.find((x) => x.label === `cognitive:${label}`) ?? this.weights.get(label);
    if (!b) throw new Error(`cognitive buffer missing: ${label}`);
    return b;
  }

  private pipeline(code: string, constants: Record<string, number> = {}): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.device.createShaderModule({ code }), entryPoint: 'main', constants },
    });
  }

  private step(pipeline: GPUComputePipeline, buffers: GPUBuffer[], grid: Step['grid']): void {
    const bind = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.steps.push({ pipeline, bind, grid });
  }

  private buildSteps(): void {
    const b = (n: string) => this.named(n);
    const { tok, dims, seqStart, logits } = this.io;
    const ceil = (a: number, d: number) => Math.ceil(a / d);
    const perToken: Step['grid'] = (t) => [t, 1];
    const perSeq: Step['grid'] = (_t, s) => [s, 1];
    const linear = (k: number, n: number, opts: { accum?: boolean; gelu?: boolean; seqRows?: boolean } = {}) =>
      this.pipeline(LINEAR_WGSL, {
        K: k, N: n, ACCUM: opts.accum ? 1 : 0, APPLY_GELU: opts.gelu ? 1 : 0, ROWS_FROM_SEQS: opts.seqRows ? 1 : 0,
      });
    const linGrid = (n: number): Step['grid'] => (t) => [n / 64, ceil(t, 64)];

    const pEmbed = this.pipeline(EMBED_WGSL);
    const pNorm = this.pipeline(LAYER_NORM_WGSL);
    const pQkv = linear(HIDDEN, 3 * HIDDEN);
    const pWo = linear(HIDDEN, HIDDEN, { accum: true });
    const pWi = linear(HIDDEN, 2 * INTERMEDIATE);
    const pWo2 = linear(INTERMEDIATE, HIDDEN, { accum: true });
    const pHead = linear(HIDDEN, HIDDEN, { gelu: true, seqRows: true });
    const pRope = this.pipeline(ROPE_WGSL);
    const pAttnLocal = this.pipeline(ATTENTION_WGSL, { GLOBAL: 0 });
    const pAttnGlobal = this.pipeline(ATTENTION_WGSL, { GLOBAL: 1 });
    const pGeglu = this.pipeline(GEGLU_WGSL);
    const pGather = this.pipeline(CLS_GATHER_WGSL);
    const pCls = this.pipeline(CLASSIFIER_WGSL);

    this.step(pEmbed, [tok, b('emb_q'), b('emb_scale'), b('h')], perToken);
    this.step(pNorm, [b('h'), b('emb_norm'), b('x')], perToken);
    for (let l = 0; l < LAYERS; l++) {
      const isGlobal = l % GLOBAL_EVERY === 0;
      let attnIn = b('x');
      if (l > 0) { // layer 0 の attn_norm は Identity
        this.step(pNorm, [b('x'), b(`l${l}.attn_norm`), b('h')], perToken);
        attnIn = b('h');
      }
      this.step(pQkv, [dims, attnIn, b(`l${l}.wqkv`), b('qkv')], linGrid(3 * HIDDEN));
      this.step(pRope, [tok, b(isGlobal ? 'cosG' : 'cosL'), b(isGlobal ? 'sinG' : 'sinL'), b('qkv')], perToken);
      this.step(isGlobal ? pAttnGlobal : pAttnLocal, [tok, b('qkv'), b('attn')], (t) => [t, HEADS]);
      this.step(pWo, [dims, b('attn'), b(`l${l}.wo`), b('x')], linGrid(HIDDEN));
      this.step(pNorm, [b('x'), b(`l${l}.mlp_norm`), b('h')], perToken);
      this.step(pWi, [dims, b('h'), b(`l${l}.wi`), b('u')], linGrid(2 * INTERMEDIATE));
      this.step(pGeglu, [dims, b('u'), b('g')], (t) => [ceil(t * INTERMEDIATE, 256), 1]);
      this.step(pWo2, [dims, b('g'), b(`l${l}.wo2`), b('x')], linGrid(HIDDEN));
    }
    this.step(pNorm, [b('x'), b('final_norm'), b('h')], perToken);
    this.step(pGather, [seqStart, b('h'), b('cls1')], perSeq);
    this.step(pHead, [dims, b('cls1'), b('head_dense'), b('cls2')], (_t, s) => [HIDDEN / 64, ceil(s, 64)]);
    this.step(pNorm, [b('cls2'), b('head_norm'), b('cls1')], perSeq);
    this.step(pCls, [dims, b('cls1'), b('cls_w'), b('cls_b'), logits], (_t, s) => [ceil(s * CLASSES, 64), 1]);
  }

  /**
   * token id 列 (系列ごと、CLS/SEP 込み) の 9 クラス logits を返す。
   * 合計トークン数は MAX_BATCH_TOKENS、系列数は MAX_BATCH_SEQS 以下であること (runner 側で分割する)。
   */
  async run(sequences: readonly (readonly number[])[]): Promise<Float32Array[]> {
    const packed = packSequences(sequences, MAX_BATCH_TOKENS, MAX_BATCH_SEQS);
    const T = packed.tokens;
    const S = sequences.length;
    const q = this.device.queue;
    q.writeBuffer(this.io.tok, 0, packed.meta);
    q.writeBuffer(this.io.seqStart, 0, packed.seqStart);
    q.writeBuffer(this.io.dims, 0, new Uint32Array([T, S, 0, 0]));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (const s of this.steps) {
      const [x, y] = s.grid(T, S);
      pass.setPipeline(s.pipeline);
      pass.setBindGroup(0, s.bind);
      pass.dispatchWorkgroups(x, y);
    }
    pass.end();
    enc.copyBufferToBuffer(this.io.logits, 0, this.io.readback, 0, S * CLASSES * 4);
    q.submit([enc.finish()]);
    await this.io.readback.mapAsync(MAP_MODE_READ, 0, S * CLASSES * 4);
    const flat = new Float32Array(this.io.readback.getMappedRange(0, S * CLASSES * 4).slice(0));
    this.io.readback.unmap();
    return Array.from({ length: S }, (_, i) => flat.subarray(i * CLASSES, (i + 1) * CLASSES));
  }

  dispose(): void {
    for (const b of this.owned) b.destroy();
    for (const b of this.weights.values()) b.destroy();
    this.owned = [];
    this.weights.clear();
    this.steps = [];
    this.device.destroy();
  }
}
