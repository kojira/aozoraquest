/**
 * sarashina (Llama 系 decoder) 用の WGSL カーネル。形状は文字列テンプレートでモデルごとに焼き込む。
 *
 * q4 重み buffer の配置 (1 buffer = ある tensor の行範囲):
 *   u32 q[rows][K/8] (word の nibble i = 要素 j*8+i、値は -8 して使う)、続けて f16 scale [rows][K/32] を u32 に 2 個ずつ。
 * 試作 (~/.pi/slm-wgsl/web/src/kernels.ts) の Llama 経路だけを移植した (DeltaNet / q,k norm / bias / gate は持たない)。
 */

export const DYN = /* wgsl */ `struct Dyn { T: u32, pos0: u32, a: u32, b: u32 };`;

/** out[t, rowBase+row] (+)= sum_k x[t, k] * W[row, k]。1 workgroup = 8 行 × TT トークン。 */
export function matmulWgsl(TT: number, acc: boolean): string {
  return /* wgsl */ `
${DYN}
struct P { N: u32, K: u32, sOff: u32, rowBase: u32, outStride: u32, xStride: u32, xOff: u32, _p: u32 };
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> x: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@group(0) @binding(4) var<uniform> d: Dyn;
var<workgroup> red: array<f32, ${256 * TT}>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let lane = lid.x % 32u;
  let r = lid.x / 32u;
  let row = wid.x * 8u + r;
  let t0 = wid.y * ${TT}u;
  var acc: array<f32, ${TT}>;
  for (var i = 0u; i < ${TT}u; i++) { acc[i] = 0.0; }
  let words = p.K / 8u;
  if (row < p.N) {
    for (var j = lane; j < words; j += 32u) {
      let w = W[row * words + j];
      let sidx = row * (p.K / 32u) + j / 4u;
      let sc = unpack2x16float(W[p.sOff + sidx / 2u])[sidx % 2u];
      let lo = vec4<f32>(f32(w & 15u), f32((w >> 4u) & 15u), f32((w >> 8u) & 15u), f32((w >> 12u) & 15u)) - 8.0;
      let hi = vec4<f32>(f32((w >> 16u) & 15u), f32((w >> 20u) & 15u), f32((w >> 24u) & 15u), f32((w >> 28u) & 15u)) - 8.0;
      for (var tt = 0u; tt < ${TT}u; tt++) {
        let t = t0 + tt;
        if (t < d.T) {
          let xb = (p.xOff + t * p.xStride + j * 8u) / 4u;
          acc[tt] += (dot(lo, x[xb]) + dot(hi, x[xb + 1u])) * sc;
        }
      }
    }
  }
  for (var tt = 0u; tt < ${TT}u; tt++) { red[tt * 256u + lid.x] = acc[tt]; }
  workgroupBarrier();
  for (var s = 16u; s > 0u; s >>= 1u) {
    if (lane < s) {
      for (var tt = 0u; tt < ${TT}u; tt++) { red[tt * 256u + lid.x] += red[tt * 256u + lid.x + s]; }
    }
    workgroupBarrier();
  }
  if (lane == 0u && row < p.N) {
    for (var tt = 0u; tt < ${TT}u; tt++) {
      let t = t0 + tt;
      if (t < d.T) {
        let oi = t * p.outStride + p.rowBase + row;
        ${acc ? 'o[oi] = o[oi] + red[tt * 256u + lid.x];' : 'o[oi] = red[tt * 256u + lid.x];'}
      }
    }
  }
}`;
}

/** x[t] = dequant(embed[ids[t]])。ids が [rowBase, rowBase+rows) の split だけが書く。1 workgroup = 1 トークン。 */
export function embedWgsl(H: number): string {
  return /* wgsl */ `
${DYN}
struct P { rows: u32, rowBase: u32, sOff: u32, _p: u32 };
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> ids: array<u32>;
@group(0) @binding(2) var<storage, read_write> x: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@group(0) @binding(4) var<uniform> d: Dyn;
@compute @workgroup_size(${H / 8})
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let t = wid.x;
  if (t >= d.T) { return; }
  let id = ids[t];
  if (id < p.rowBase || id >= p.rowBase + p.rows) { return; }
  let row = id - p.rowBase;
  let j = lid.x;
  let w = W[row * ${H / 8}u + j];
  let sidx = row * ${H / 32}u + j / 4u;
  let sc = unpack2x16float(W[p.sOff + sidx / 2u])[sidx % 2u];
  for (var i = 0u; i < 8u; i++) {
    x[t * ${H}u + j * 8u + i] = (f32((w >> (4u * i)) & 15u) - 8.0) * sc;
  }
}`;
}

/** 長さ H の行ごとの RMSNorm。 */
export function rmsnormWgsl(H: number, eps: number): string {
  return /* wgsl */ `
${DYN}
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read_write> o: array<f32>;
@group(0) @binding(3) var<uniform> d: Dyn;
var<workgroup> red: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let t = wid.x;
  if (t >= d.T) { return; }
  var s = 0.0;
  for (var i = lid.x; i < ${H}u; i += 256u) { let v = x[t * ${H}u + i]; s += v * v; }
  red[lid.x] = s;
  workgroupBarrier();
  for (var k = 128u; k > 0u; k >>= 1u) { if (lid.x < k) { red[lid.x] += red[lid.x + k]; } workgroupBarrier(); }
  let inv = inverseSqrt(red[0] / ${H}.0 + ${eps});
  for (var i = lid.x; i < ${H}u; i += 256u) { o[t * ${H}u + i] = x[t * ${H}u + i] * inv * w[i]; }
}`;
}

/** h[t, i] = silu(g[t, i]) * u[t, i]。g/u は融合 [T, 2*I]。 */
export function swigluWgsl(I: number): string {
  return /* wgsl */ `
${DYN}
@group(0) @binding(0) var<storage, read> gu: array<f32>;
@group(0) @binding(1) var<storage, read_write> h: array<f32>;
@group(0) @binding(2) var<uniform> d: Dyn;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let t = gid.y;
  if (i >= ${I}u || t >= d.T) { return; }
  let g = gu[t * ${2 * I}u + i];
  h[t * ${I}u + i] = g / (1.0 + exp(-g)) * gu[t * ${2 * I}u + ${I}u + i];
}`;
}

export interface AttnDims { heads: number; kvHeads: number; hd: number; theta: number; maxCtx: number }

/** RoPE (rotate_half) を q/k に掛け、q → qb、k/v → f16 KV cache (位置 pos0+t)。1 workgroup = (head slot, t)。 */
export function qkprepWgsl(a: AttnDims): string {
  const inN = (a.heads + 2 * a.kvHeads) * a.hd;
  const half = a.hd / 2;
  return /* wgsl */ `
${DYN}
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> qb: array<f32>;
@group(0) @binding(2) var<storage, read_write> kc: array<u32>;
@group(0) @binding(3) var<storage, read_write> vc: array<u32>;
@group(0) @binding(4) var<uniform> d: Dyn;
var<workgroup> v: array<f32, ${a.hd}>;
var<workgroup> r: array<f32, ${a.hd}>;
@compute @workgroup_size(128)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let slot = wid.x;  // [0, heads) q、[heads, heads+kv) k、残り v
  let t = wid.y;
  if (t >= d.T) { return; }
  let pos = d.pos0 + t;
  var kind = 0u;
  if (slot >= ${a.heads}u) { kind = select(2u, 1u, slot < ${a.heads + a.kvHeads}u); }
  let base = t * ${inN}u + slot * ${a.hd}u;
  for (var i = lid.x; i < ${a.hd}u; i += 128u) { v[i] = inp[base + i]; }
  workgroupBarrier();
  for (var i = lid.x; i < ${a.hd}u; i += 128u) {
    var e = v[i];
    if (kind < 2u) {
      let fi = i % ${half}u;
      let invf = exp2(-f32(2u * fi) / ${a.hd}.0 * log2(${a.theta}.0));
      let ang = f32(pos) * invf;
      let c = cos(ang);
      let sn = sin(ang);
      if (i < ${half}u) { e = v[i] * c - v[i + ${half}u] * sn; } else { e = v[i] * c + v[i - ${half}u] * sn; }
    }
    r[i] = e;
  }
  workgroupBarrier();
  if (kind == 0u) {
    for (var i = lid.x; i < ${a.hd}u; i += 128u) { qb[(t * ${a.heads}u + slot) * ${a.hd}u + i] = r[i]; }
  } else {
    let kvh = select(slot - ${a.heads + a.kvHeads}u, slot - ${a.heads}u, kind == 1u);
    for (var i = lid.x; i < ${half}u; i += 128u) {
      let wv = pack2x16float(vec2<f32>(r[2u * i], r[2u * i + 1u]));
      let ci = (pos * ${a.kvHeads}u + kvh) * ${half}u + i;
      if (kind == 1u) { kc[ci] = wv; } else { vc[ci] = wv; }
    }
  }
}`;
}

/** f16 KV cache 上の causal GQA attention。1 workgroup = (head, t)。 */
export function attentionWgsl(a: AttnDims): string {
  const grp = a.heads / a.kvHeads;
  const hw = a.hd / 2;
  const nsp = Math.floor(256 / hw); // 位置の分割数。split >= nsp のレーンは休む (hd 80 → 6 分割 × 40)
  return /* wgsl */ `
${DYN}
@group(0) @binding(0) var<storage, read> qb: array<f32>;
@group(0) @binding(1) var<storage, read> kc: array<u32>;
@group(0) @binding(2) var<storage, read> vc: array<u32>;
@group(0) @binding(3) var<storage, read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> d: Dyn;
var<workgroup> sc: array<f32, ${a.maxCtx}>;
var<workgroup> q: array<f32, ${a.hd}>;
var<workgroup> red: array<f32, 256>;
var<workgroup> part: array<vec2<f32>, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let h = wid.x;
  let t = wid.y;
  if (t >= d.T) { return; }
  let L = d.pos0 + t + 1u;
  let kvh = h / ${grp}u;
  for (var i = lid.x; i < ${a.hd}u; i += 256u) { q[i] = qb[(t * ${a.heads}u + h) * ${a.hd}u + i]; }
  workgroupBarrier();
  var mx = -3.0e38;
  for (var p = lid.x; p < L; p += 256u) {
    let kb = (p * ${a.kvHeads}u + kvh) * ${hw}u;
    var s = 0.0;
    for (var i = 0u; i < ${hw}u; i++) {
      let kk = unpack2x16float(kc[kb + i]);
      s += q[2u * i] * kk.x + q[2u * i + 1u] * kk.y;
    }
    s *= ${1 / Math.sqrt(a.hd)};
    sc[p] = s;
    mx = max(mx, s);
  }
  red[lid.x] = mx;
  workgroupBarrier();
  for (var k = 128u; k > 0u; k >>= 1u) { if (lid.x < k) { red[lid.x] = max(red[lid.x], red[lid.x + k]); } workgroupBarrier(); }
  let m = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var p = lid.x; p < L; p += 256u) { let e = exp(sc[p] - m); sc[p] = e; sum += e; }
  red[lid.x] = sum;
  workgroupBarrier();
  for (var k = 128u; k > 0u; k >>= 1u) { if (lid.x < k) { red[lid.x] += red[lid.x + k]; } workgroupBarrier(); }
  let tot = red[0];
  let col = lid.x % ${hw}u;
  let split = lid.x / ${hw}u;
  var acc = vec2<f32>(0.0, 0.0);
  for (var p = split; p < L && split < ${nsp}u; p += ${nsp}u) {
    acc += sc[p] * unpack2x16float(vc[(p * ${a.kvHeads}u + kvh) * ${hw}u + col]);
  }
  part[lid.x] = acc;
  workgroupBarrier();
  if (split == 0u) {
    var r = part[col];
    for (var sp = 1u; sp < ${nsp}u; sp++) { r += part[sp * ${hw}u + col]; }
    r /= tot;
    o[(t * ${a.heads}u + h) * ${a.hd}u + 2u * col] = r.x;
    o[(t * ${a.heads}u + h) * ${a.hd}u + 2u * col + 1u] = r.y;
  }
}`;
}

/** 反復 argmax による top-K。段 1: B 個ごとのブロック → K 候補、段 2 (indirect=true): 候補全体から K。 */
export function topkWgsl(K: number, B: number, indirect: boolean): string {
  return /* wgsl */ `
struct P { n: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<storage, read_write> vals: array<f32>;
@group(0) @binding(1) var<storage, read> idxIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> ov: array<f32>;
@group(0) @binding(3) var<storage, read_write> oi: array<u32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> bv: array<f32, 256>;
var<workgroup> bi: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let start = wid.x * ${B}u;
  let end = min(start + ${B}u, p.n);
  for (var it = 0u; it < ${K}u; it++) {
    var best = -3.4e38;
    var bidx = 0xffffffffu;
    for (var i = start + lid.x; i < end; i += 256u) { let v = vals[i]; if (v > best) { best = v; bidx = i; } }
    bv[lid.x] = best;
    bi[lid.x] = bidx;
    workgroupBarrier();
    for (var k = 128u; k > 0u; k >>= 1u) {
      if (lid.x < k) {
        if (bv[lid.x + k] > bv[lid.x] || (bv[lid.x + k] == bv[lid.x] && bi[lid.x + k] < bi[lid.x])) { bv[lid.x] = bv[lid.x + k]; bi[lid.x] = bi[lid.x + k]; }
      }
      workgroupBarrier();
    }
    if (lid.x == 0u) {
      let w = bi[0];
      ov[wid.x * ${K}u + it] = bv[0];
      if (w == 0xffffffffu) { oi[wid.x * ${K}u + it] = 0u; }
      else {
        ${indirect ? `oi[wid.x * ${K}u + it] = idxIn[w];` : `oi[wid.x * ${K}u + it] = w;`}
        vals[w] = -3.4e38;
      }
    }
    storageBarrier();
    workgroupBarrier();
  }
}`;
}
