/**
 * ジョブ素ステータスの生成器 (docs/03-game-design.md / packages/core/src/jobs.ts の
 * stats を再現・検証するための単一ソース)。
 *
 * モデル: 各ジョブの dominant/auxiliary から MBTI の認知機能スタックを組み、
 *   dom 1.0 / aux 0.5 / tertiary 0.25 / inferior 0.125 の重みで COGNITIVE_TO_RPG を
 *   合成 → 合計 100 に正規化 (= 理論値)。
 *   tertiary = flip(aux)、inferior = flip(dom) (flip = 機能文字と態度を反転)。
 * さらにレーダー表示が軸潰れしないよう floor を噛ませる:
 *   v = FLOOR + (1 - 5*FLOOR/100) * 理論値
 *   これは理論値に対する affine 変換なので純理論値と形 (Pearson 相関) は 1.0、
 *   かつ最小値 FLOOR を保証する。
 *
 * 実行: pnpm tsx scripts/gen-job-stats.ts
 */
import { JOBS, COGNITIVE_TO_RPG, STATS, type CogFunction } from '@aozoraquest/core';

const STACK_W = { dom: 1.0, aux: 0.5, tert: 0.25, inf: 0.125 };
const FLOOR = 6;
const SCALE = 1 - (5 * FLOOR) / 100; // = 0.7。floor 込みで合計 100 を保つ係数

const FLIP_LETTER: Record<string, string> = { N: 'S', S: 'N', T: 'F', F: 'T' };
const FLIP_ATT: Record<string, string> = { i: 'e', e: 'i' };
function flip(fn: CogFunction): CogFunction {
  return (FLIP_LETTER[fn[0]!]! + FLIP_ATT[fn[1]!]!) as CogFunction;
}

function largestRemainder(values: number[]): number[] {
  const base = values.map(Math.floor);
  const rem = 100 - base.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac)
    .map((x) => x.i);
  for (let k = 0; k < rem; k++) {
    const idx = order[k]!;
    base[idx] = base[idx]! + 1;
  }
  return base;
}

for (const job of JOBS) {
  const stack: Partial<Record<CogFunction, number>> = {
    [job.dominantFunction]: STACK_W.dom,
    [job.auxiliaryFunction]: STACK_W.aux,
    [flip(job.auxiliaryFunction)]: STACK_W.tert,
    [flip(job.dominantFunction)]: STACK_W.inf,
  };
  const raw: Record<string, number> = Object.fromEntries(STATS.map((s) => [s, 0]));
  for (const [fn, w] of Object.entries(stack)) {
    for (const s of STATS) raw[s] += (w as number) * COGNITIVE_TO_RPG[fn as CogFunction][s];
  }
  const tot = STATS.reduce((a, s) => a + raw[s]!, 0);
  const floored = largestRemainder(STATS.map((s) => FLOOR + SCALE * ((raw[s]! / tot) * 100)));
  const sum = floored.reduce((a, b) => a + b, 0);
  console.log(`${job.id.padEnd(10)} ${job.dominantFunction}/${job.auxiliaryFunction}  [${floored.map((v) => String(v).padStart(2)).join(', ')}]  sum=${sum}`);
}
