/**
 * GPU に渡す前の CPU 側の下ごしらえ (WebGPU に依存しない純関数なので unit test 対象)。
 */

export interface PackedBatch {
  /** 連結後の総トークン数。 */
  tokens: number;
  /** トークンごとの {tokenId, 系列先頭 index, 系列長, 系列内位置} (vec4<u32>)。 */
  meta: Uint32Array;
  /** 系列ごとの先頭トークン index (CLS 位置)。 */
  seqStart: Uint32Array;
}

/** 系列を 1 列に連結する。容量を超える入力は呼び出し側のバグなので throw する。 */
export function packSequences(
  sequences: readonly (readonly number[])[],
  maxTokens: number,
  maxSeqs: number,
): PackedBatch {
  if (sequences.length === 0 || sequences.length > maxSeqs) {
    throw new Error(`packSequences: ${sequences.length} sequences (max ${maxSeqs})`);
  }
  const tokens = sequences.reduce((s, q) => s + q.length, 0);
  if (tokens > maxTokens) throw new Error(`packSequences: ${tokens} tokens (max ${maxTokens})`);
  const meta = new Uint32Array(tokens * 4);
  const seqStart = new Uint32Array(sequences.length);
  let t = 0;
  sequences.forEach((seq, s) => {
    if (seq.length === 0) throw new Error('packSequences: empty sequence');
    seqStart[s] = t;
    for (let p = 0; p < seq.length; p++, t++) {
      meta[t * 4] = seq[p]!;
      meta[t * 4 + 1] = seqStart[s]!;
      meta[t * 4 + 2] = seq.length;
      meta[t * 4 + 3] = p;
    }
  });
  return { tokens, meta, seqStart };
}

/**
 * 系列を「合計 maxTokens 以下かつ maxSeqs 本以下」のバッチへ順序を保って詰める。
 * 戻り値は元配列の index のグループ。
 */
export function planBatches(lengths: readonly number[], maxTokens: number, maxSeqs: number): number[][] {
  const batches: number[][] = [];
  let cur: number[] = [];
  let curTokens = 0;
  lengths.forEach((len, i) => {
    if (len > maxTokens) throw new Error(`planBatches: sequence of ${len} tokens exceeds ${maxTokens}`);
    if (cur.length > 0 && (curTokens + len > maxTokens || cur.length >= maxSeqs)) {
      batches.push(cur);
      cur = [];
      curTokens = 0;
    }
    cur.push(i);
    curTokens += len;
  });
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/**
 * RoPE の cos/sin 表 [pos, headDim/2]。HF ModernBERT と同じく
 * inv_freq[i] = theta^(-2i/headDim)、角度 = pos * inv_freq[i]。倍精度で計算して f32 に落とす。
 */
export function buildRopeTables(maxPos: number, headDim: number, theta: number): { cos: Float32Array; sin: Float32Array } {
  const half = headDim / 2;
  const cos = new Float32Array(maxPos * half);
  const sin = new Float32Array(maxPos * half);
  for (let p = 0; p < maxPos; p++) {
    for (let i = 0; i < half; i++) {
      const invFreq = Math.fround(1 / Math.pow(theta, (2 * i) / headDim));
      const angle = Math.fround(p * invFreq);
      cos[p * half + i] = Math.cos(angle);
      sin[p * half + i] = Math.sin(angle);
    }
  }
  return { cos, sin };
}

/** logits → softmax 確率。 */
export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]!);
  const exps = Array.from({ length: logits.length }, (_, i) => Math.exp(logits[i]! - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}
