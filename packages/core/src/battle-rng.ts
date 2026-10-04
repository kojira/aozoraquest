/**
 * 決定的乱数 (mulberry32 / ターン毎の乱数器)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

// ─── 決定的乱数 (mulberry32) ────────────────────────────────

/** 32bit シードから [0,1) の決定的乱数列を作る。 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** seed とターン番号から、そのターン専用の乱数器を作る (state を JSON 化可能に保つ)。 */
export function turnRng(seed: number, turn: number): () => number {
  // 単純な混合 (定数は splitmix64 の黄金比由来)
  return createRng((seed ^ Math.imul(turn + 1, 0x9e3779b1)) >>> 0);
}
