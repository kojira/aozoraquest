/**
 * ドロップ・敗北時の損失・しらべる・称号。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { type Tier, ITEMS, MONSTERS_BY_ID, MONSTERS } from './battle-monsters.js';

// ─── ドロップ・称号 ─────────────────────────────────────────

/**
 * 敗北時に落とす素材を決定的に判定する (luk が高いほど落としにくい)。
 * - 手持ち (materials: id → 個数) から個数重みで 1 個は必ず落ちる (手持ちが空なら何も落ちない)。
 * - 以降は clamp(lossExtraBase − luk*lossExtraLukScale, lossExtraMin, 1) の確率で
 *   追加 1 個、最大 lossMax 個まで (luk が高いほど追加を引きにくい)。
 * - seed から決定的。ただし入力の在庫スナップショットはレコードに残らないため、
 *   記録単体からの再現・検証はできない (materialsLost は他の戦闘結果と同じく
 *   クライアント申告値。検証可能化は W3 のサーバー権威で扱う)。
 */
export function rollDefeatLoss(materials: Record<string, number>, luk: number, seed: number): string[] {
  const t = BATTLE_TUNING;
  const rng = createRng((seed ^ 0x7b0c9d21) >>> 0);
  const pool: string[] = [];
  for (const [id, n] of Object.entries(materials)) {
    // **だいじなもの (シナリオアイテム) は失わない。** 進行に要るものが敗北で
    // 消えると、そのプレイヤーは筋書きを進められなくなる。
    if (ITEMS[id]?.key) continue;
    for (let i = 0; i < n; i++) pool.push(id);
  }
  const lost: string[] = [];
  const extraChance = Math.min(1, Math.max(t.lossExtraMin, t.lossExtraBase - luk * t.lossExtraLukScale));
  while (pool.length > 0 && lost.length < t.lossMax) {
    if (lost.length > 0 && rng() >= extraChance) break;
    const i = Math.floor(rng() * pool.length);
    lost.push(pool[i]!);
    pool.splice(i, 1);
  }
  return lost;
}

/** 勝利時のドロップ判定。luk で上振れ。決定的 (seed 依存)。dropBonus = 巫女の直感の加算 (#456)。 */
export function rollDrops(monsterId: string, luk: number, seed: number, dropBonus = 0): string[] {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return [];
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const out: string[] = [];
  for (const d of def.drops) {
    // luk ボーナス + 巫女の直感 dropBonus を合算し 0.95 で clamp。dropBonus は luk 補正と天井 (0.95) を
    // **共有**するので、高 luk 職 (巫女=luk37) では既にドロップ率が高い素材で +0.1 の限界効用が逓減する
    // (青天井を防ぐ意図的な設計。数値は sim 前提の暫定値)。
    const chance = Math.min(0.95, d.chance + luk * BATTLE_TUNING.dropLukScale + dropBonus);
    if (rng() < chance) out.push(d.item);
  }
  return out;
}

/** 「しらべる」(フィールドコマンド) の調整値。luk に連動して入手、パワーを 1 消費。 */
export const SEARCH_TUNING = {
  powerCost: 1,
  /** 何か見つかる基礎確率 (luk 0)。 */
  baseFindChance: 0.4,
  /** luk 1 あたりの発見確率上乗せ。 */
  findLukScale: 0.006,
  /** 発見確率の上限。 */
  maxFindChance: 0.75,
  /** 見つかったとき「その地方の素材 (tier ドロップ)」になる確率。残りは消耗品。
   *  luk でこの比率が上がる (良い運ほど素材が出やすい)。 */
  materialBase: 0.35,
  materialLukScale: 0.006,
  materialMax: 0.7,
} as const;

/** tier のモンスターが落とす素材 (しらべるで見つかる地方素材の母集団)。 */
function tierMaterials(tier: Tier): string[] {
  const set = new Set<string>();
  for (const m of MONSTERS) if (m.tier === tier && !m.storyOnly) for (const d of m.drops) set.add(d.item);
  // 消耗品ドロップ (herb/sky-dew/sky-feather) は除き、純粋な素材だけ
  return [...set].filter((id) => id !== 'herb' && id !== 'sky-dew' && id !== 'sky-feather');
}

/**
 * 「しらべる」の結果 (決定的)。luk が高いほど「見つかる確率」と「素材が出る比率」が
 * 上がる。見つからなければ null。seed はプレビューでは Math.random、W3 で Worker の
 * 署名付き seed に置き換える (rollDrops と同じ扱い)。
 */
export function rollSearch(seed: number, luk: number, tier: Tier): string | null {
  const t = SEARCH_TUNING;
  // salt は他の roll (summonMonster/rollDrops/rollDefeatLoss) と別値にして、W3 で
  // seed を共有したときに rng ストリームが相関しないようにする (レビュー ★)
  const rng = createRng((seed ^ 0x3c6ef35f) >>> 0);
  const findChance = Math.min(t.maxFindChance, t.baseFindChance + luk * t.findLukScale);
  if (rng() >= findChance) return null; // 何も見つからなかった
  const matChance = Math.min(t.materialMax, t.materialBase + luk * t.materialLukScale);
  if (rng() < matChance) {
    const pool = tierMaterials(tier);
    if (pool.length > 0) return pool[Math.floor(rng() * pool.length)]!;
  }
  // 消耗品: やくそう多め、そらのしずく少なめ
  return rng() < 0.7 ? 'herb' : 'sky-dew';
}

/** 通算戦績 (UI/記録側で集計して渡す)。 */
export interface BattleRecordSummary {
  wins: number;
  losses: number;
  bestStreak: number;
  tier3Wins: number;
}

export interface TitleDef {
  id: string;
  name: string;
  /** 達成条件の説明 */
  description: string;
  earned: (r: BattleRecordSummary) => boolean;
}

/** 称号。上から順に評価し、獲得済みのものを全部返す (UI は最後尾 = 最高位を出す等)。 */
export const TITLES: readonly TitleDef[] = [
  { id: 'first-win', name: '試練の一歩', description: 'はじめての勝利', earned: (r) => r.wins >= 1 },
  { id: 'ten-wins', name: '駆け出しの挑戦者', description: '通算 10 勝', earned: (r) => r.wins >= 10 },
  { id: 'streak-5', name: '波に乗る者', description: '5 連勝', earned: (r) => r.bestStreak >= 5 },
  { id: 'fifty-wins', name: '歴戦の空渡り', description: '通算 50 勝', earned: (r) => r.wins >= 50 },
  { id: 'streak-10', name: '不倒の旗印', description: '10 連勝', earned: (r) => r.bestStreak >= 10 },
  { id: 'tier3-10', name: '真剣勝負の常連', description: '真剣勝負で 10 勝', earned: (r) => r.tier3Wins >= 10 },
  { id: 'hundred-wins', name: '蒼穹の覇者', description: '通算 100 勝', earned: (r) => r.wins >= 100 },
];

export function earnedTitles(r: BattleRecordSummary): TitleDef[] {
  return TITLES.filter((t) => t.earned(r));
}
