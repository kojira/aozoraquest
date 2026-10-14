/**
 * cognitive-small (ModernBERT 9-class) 推論用の WGSL カーネル群。
 *
 * 入力はパディングしない「packed」形式: バッチ内の全系列のトークンを 1 列に連結し、
 * トークンごとのメタ {tokenId, 系列先頭 index, 系列長, 系列内位置} で attention の範囲を決める。
 * attention mask の代わりに「同一系列内だけを見る」ので、パディング分の計算もない。
 *
 * 行列の重みは fp16 を u32 に 2 個ずつ詰めた [out, in] 配置 (unpack2x16float で読む。
 * shader-f16 拡張は不要)。埋め込みは int8 を u32 に 4 個ずつ詰め、行ごとの scale を持つ。
 */

export const HIDDEN = 256;
export const HEADS = 4;
export const HEAD_DIM = 64;
export const INTERMEDIATE = 1024;
/** ModernBERT local attention 128 = 前後 64 トークン。 */
export const LOCAL_HALF_WINDOW = 64;
/** 1 系列の最大トークン数 (attention の workgroup 配列長)。これを超える系列は切り詰める。 */
export const MAX_SEQ_TOKENS = 1024;
export const NORM_EPS = 1e-5;

const DIMS = /* wgsl */ `
struct Dims { tokens: u32, seqs: u32, pad0: u32, pad1: u32 }
`;

/** GELU (erf 版)。erf は Abramowitz-Stegun 7.1.26 (絶対誤差 1.5e-7)。 */
const GELU = /* wgsl */ `
fn erf_approx(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return select(y, -y, x < 0.0);
}
fn gelu(x: f32) -> f32 { return 0.5 * x * (1.0 + erf_approx(x * 0.70710678118654752)); }
`;

/**
 * 埋め込み gather: out[t, :] = int8 行 * 行 scale。1 workgroup = 1 トークン、64 thread × 4 要素。
 */
export const EMBED_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> tok: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> embQ: array<u32>;
@group(0) @binding(2) var<storage, read> embScale: array<f32>;
@group(0) @binding(3) var<storage, read_write> outp: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let t = wg.x;
  let id = tok[t].x;
  let packed = embQ[id * 64u + lid.x];
  let s = embScale[id];
  for (var k = 0u; k < 4u; k++) {
    let b = bitcast<i32>(packed << (24u - 8u * k)) >> 24u;
    outp[t * ${HIDDEN}u + lid.x * 4u + k] = f32(b) * s;
  }
}
`;

/** LayerNorm (bias なし)。1 workgroup = 1 行。平均→分散の 2 パスで計算する。 */
export const LAYER_NORM_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read> weight: array<f32>;
@group(0) @binding(2) var<storage, read_write> outp: array<f32>;
var<workgroup> red: array<f32, 64>;

fn reduce_sum(lid: u32) {
  for (var s = 32u; s > 0u; s = s >> 1u) {
    if (lid < s) { red[lid] = red[lid] + red[lid + s]; }
    workgroupBarrier();
  }
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let base = wg.x * ${HIDDEN}u;
  var v: array<f32, 4>;
  var s = 0.0;
  for (var i = 0u; i < 4u; i++) { v[i] = inp[base + lid.x + i * 64u]; s = s + v[i]; }
  red[lid.x] = s;
  workgroupBarrier();
  reduce_sum(lid.x);
  let mean = red[0] / ${HIDDEN}.0;
  workgroupBarrier();
  var q = 0.0;
  for (var i = 0u; i < 4u; i++) { let d = v[i] - mean; q = q + d * d; }
  red[lid.x] = q;
  workgroupBarrier();
  reduce_sum(lid.x);
  let inv = 1.0 / sqrt(red[0] / ${HIDDEN}.0 + ${NORM_EPS});
  for (var i = 0u; i < 4u; i++) {
    let c = lid.x + i * 64u;
    outp[base + c] = (v[i] - mean) * inv * weight[c];
  }
}
`;

/**
 * 線形層 out[r, n] (=|+=) sum_k inp[r, k] * W[n, k]。64×64 タイル、1 thread が 4×4 出力。
 * K, N, ACCUM (残差加算), GELU (出力に GELU), ROWS_FROM_SEQS (行数 = 系列数) は override 定数。
 */
export const LINEAR_WGSL = /* wgsl */ `
${DIMS}
${GELU}
override K: u32;
override N: u32;
override ACCUM: bool = false;
override APPLY_GELU: bool = false;
override ROWS_FROM_SEQS: bool = false;
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> inp: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<u32>;
@group(0) @binding(3) var<storage, read_write> outp: array<f32>;
var<workgroup> As: array<f32, 1024>;
var<workgroup> Bs: array<f32, 1024>;

@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let rows = select(dims.tokens, dims.seqs, ROWS_FROM_SEQS);
  let rowBase = wg.y * 64u;
  let colBase = wg.x * 64u;
  let tid = lid.y * 16u + lid.x;
  var acc: array<array<f32, 4>, 4>;
  for (var k0 = 0u; k0 < K; k0 += 16u) {
    for (var i = 0u; i < 4u; i++) {
      let e = tid + i * 256u;
      let r = e / 16u;
      let k = e % 16u;
      let gr = rowBase + r;
      var a = 0.0;
      if (gr < rows) { a = inp[gr * K + k0 + k]; }
      As[k * 64u + r] = a;
    }
    for (var i = 0u; i < 2u; i++) {
      let e = tid + i * 256u;
      let c = e / 8u;
      let kp = e % 8u;
      let pair = unpack2x16float(w[((colBase + c) * K + k0) / 2u + kp]);
      Bs[(2u * kp) * 64u + c] = pair.x;
      Bs[(2u * kp + 1u) * 64u + c] = pair.y;
    }
    workgroupBarrier();
    for (var k = 0u; k < 16u; k++) {
      var a4: array<f32, 4>;
      var b4: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) {
        a4[i] = As[k * 64u + lid.y * 4u + i];
        b4[i] = Bs[k * 64u + lid.x * 4u + i];
      }
      for (var i = 0u; i < 4u; i++) {
        for (var j = 0u; j < 4u; j++) { acc[i][j] = acc[i][j] + a4[i] * b4[j]; }
      }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    let r = rowBase + lid.y * 4u + i;
    if (r >= rows) { continue; }
    for (var j = 0u; j < 4u; j++) {
      let idx = r * N + colBase + lid.x * 4u + j;
      var v = acc[i][j];
      if (APPLY_GELU) { v = gelu(v); }
      if (ACCUM) { v = v + outp[idx]; }
      outp[idx] = v;
    }
  }
}
`;

/**
 * RoPE を qkv [T, 3*HIDDEN] の q, k 部分に in-place 適用 (rotate_half 形式)。
 * cos/sin 表は [pos, HEAD_DIM/2] で CPU が作って渡す (local / global で theta 違いの 2 表)。
 */
export const ROPE_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> tok: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> cosT: array<f32>;
@group(0) @binding(2) var<storage, read> sinT: array<f32>;
@group(0) @binding(3) var<storage, read_write> qkv: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let t = wg.x;
  let pos = tok[t].w;
  let part = lid.x / 128u;          // 0 = q, 1 = k
  let h = (lid.x / 32u) % 4u;
  let i = lid.x % 32u;
  let base = t * ${3 * HIDDEN}u + part * ${HIDDEN}u + h * ${HEAD_DIM}u;
  let c = cosT[pos * 32u + i];
  let s = sinT[pos * 32u + i];
  let x1 = qkv[base + i];
  let x2 = qkv[base + i + 32u];
  qkv[base + i] = x1 * c - x2 * s;
  qkv[base + i + 32u] = x2 * c + x1 * s;
}
`;

/**
 * 自己 attention。1 workgroup = (トークン t, head h)、64 thread = head 次元。
 * 範囲は同一系列内。GLOBAL=false の層は |i-j| <= 64 の窓に限る。
 */
export const ATTENTION_WGSL = /* wgsl */ `
override GLOBAL: bool = false;
@group(0) @binding(0) var<storage, read> tok: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> qkv: array<f32>;
@group(0) @binding(2) var<storage, read_write> outp: array<f32>;
var<workgroup> qs: array<f32, 64>;
var<workgroup> sc: array<f32, ${MAX_SEQ_TOKENS}>;
var<workgroup> red: array<f32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let t = wg.x;
  let h = wg.y;
  let info = tok[t];
  let start = info.y;
  let len = info.z;
  let pos = info.w;
  var lo = 0u;
  var hi = len;
  if (!GLOBAL) {
    lo = max(pos, ${LOCAL_HALF_WINDOW}u) - ${LOCAL_HALF_WINDOW}u;
    hi = min(len, pos + ${LOCAL_HALF_WINDOW + 1}u);
  }
  let n = hi - lo;
  qs[lid.x] = qkv[t * ${3 * HIDDEN}u + h * ${HEAD_DIM}u + lid.x];
  workgroupBarrier();
  var m = -3.4e38;
  for (var j = lid.x; j < n; j += 64u) {
    let kb = (start + lo + j) * ${3 * HIDDEN}u + ${HIDDEN}u + h * ${HEAD_DIM}u;
    var s = 0.0;
    for (var d = 0u; d < 64u; d++) { s = s + qs[d] * qkv[kb + d]; }
    s = s * 0.125;
    sc[j] = s;
    m = max(m, s);
  }
  red[lid.x] = m;
  workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) {
    if (lid.x < st) { red[lid.x] = max(red[lid.x], red[lid.x + st]); }
    workgroupBarrier();
  }
  let mx = red[0];
  workgroupBarrier();
  var sum = 0.0;
  for (var j = lid.x; j < n; j += 64u) {
    let p = exp(sc[j] - mx);
    sc[j] = p;
    sum = sum + p;
  }
  red[lid.x] = sum;
  workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) {
    if (lid.x < st) { red[lid.x] = red[lid.x] + red[lid.x + st]; }
    workgroupBarrier();
  }
  let total = red[0];
  var acc = 0.0;
  for (var j = 0u; j < n; j++) {
    acc = acc + sc[j] * qkv[(start + lo + j) * ${3 * HIDDEN}u + ${2 * HIDDEN}u + h * ${HEAD_DIM}u + lid.x];
  }
  outp[t * ${HIDDEN}u + h * ${HEAD_DIM}u + lid.x] = acc / total;
}
`;

/** GeGLU: g[t, c] = gelu(u[t, c]) * u[t, INTERMEDIATE + c]。 */
export const GEGLU_WGSL = /* wgsl */ `
${DIMS}
${GELU}
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> u: array<f32>;
@group(0) @binding(2) var<storage, read_write> g: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= dims.tokens * ${INTERMEDIATE}u) { return; }
  let t = idx / ${INTERMEDIATE}u;
  let c = idx % ${INTERMEDIATE}u;
  g[idx] = gelu(u[t * ${2 * INTERMEDIATE}u + c]) * u[t * ${2 * INTERMEDIATE}u + ${INTERMEDIATE}u + c];
}
`;

/** 各系列の CLS (先頭トークン) 行を集める。1 workgroup = 1 系列。 */
export const CLS_GATHER_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read> seqStart: array<u32>;
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> outp: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  outp[wg.x * ${HIDDEN}u + lid.x] = x[seqStart[wg.x] * ${HIDDEN}u + lid.x];
}
`;

/** 分類器: logits[s, k] = sum_d h[s, d] * W[k, d] + b[k] (fp32 重み、9 クラス)。 */
export const CLASSIFIER_WGSL = /* wgsl */ `
${DIMS}
override CLASSES: u32 = 9u;
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> h: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> b: array<f32>;
@group(0) @binding(4) var<storage, read_write> logits: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= dims.seqs * CLASSES) { return; }
  let s = idx / CLASSES;
  let k = idx % CLASSES;
  var acc = b[k];
  for (var d = 0u; d < ${HIDDEN}u; d++) { acc = acc + h[s * ${HIDDEN}u + d] * w[k * ${HIDDEN}u + d]; }
  logits[idx] = acc;
}
`;
