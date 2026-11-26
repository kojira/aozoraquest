/**
 * ドロップ・敗北時の損失・しらべる・称号。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { type Tier, ITEMS, MONSTERS_BY_ID, MONSTERS } from './battle-monsters.js';
import { LEGACY_MATERIAL_IDS, STONE_IDS, STONE_RULES, isStoneId, monsterStoneElement, rollStoneDrops } from './mana-stones.js';

// ─── ドロップ・称号 ─────────────────────────────────────────

/**
 * 敗北時に落とす素材を決定的に判定する (luk が高いほど落としにくい)。
 * - 手持ち (materials: id → 個数) から個数重みで 1 個は必ず落ちる (手持ちが空なら何も落ちない)。
 * - 以降は clamp(lossExtraBase − luk*lossExtraLukScale, lossExtraMin, 1) の確率で
 *   追加 1 回、最大 lossMax 回まで (luk が高いほど追加を引きにくい)。魔石は 1 回で 3 個 (最大 9 個)。
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
    // カジノの景品 (コインで買ったどうぐ) も失わない (D-CASINO-001)。
    if (ITEMS[id]?.key || ITEMS[id]?.casinoOnly || ITEMS[id]?.precious) continue; // 貴重なもの (D-REVIVE-001) も
    for (let i = 0; i < n; i++) pool.push(id);
  }
  const lost: string[] = [];
  const extraChance = Math.min(1, Math.max(t.lossExtraMin, t.lossExtraBase - luk * t.lossExtraLukScale));
  for (let picks = 0; pool.length > 0 && picks < t.lossMax; picks++) {
    if (picks > 0 && rng() >= extraChance) break;
    const i = Math.floor(rng() * pool.length);
    const id = pool[i]!;
    // 魔石は 1 回で lossStonesPerPick 個まで (旧素材 1 個 = 魔石 3 個の値打ち。D-MATERIAL-001)。
    for (let k = 0; k < (isStoneId(id) ? STONE_RULES.lossStonesPerPick : 1); k++) {
      const j = k === 0 ? i : pool.indexOf(id);
      if (j < 0) break;
      lost.push(id);
      pool.splice(j, 1);
    }
  }
  return lost;
}

/** 勝利時のドロップ判定 (消耗品は確率、魔石は必ず)。luk で上振れ。決定的 (seed 依存)。dropBonus = 巫女の直感の加算 (#456)。 */
export function rollDrops(monsterId: string, luk: number, seed: number, dropBonus = 0): string[] {
  const def = MONSTERS_BY_ID[monsterId];
  if (!def) return [];
  const rng = createRng((seed ^ 0x2545f491) >>> 0);
  const out: string[] = [];
  for (const d of def.drops) {
    // 旧素材 (魔石になる前の id) は落とさない。魔石は rollStoneDrops (別の乱数) で必ず落ちる (D-MATERIAL-001)。
    if (LEGACY_MATERIAL_IDS.includes(d.item)) continue;
    // luk ボーナス + 巫女の直感 dropBonus を合算し 0.95 で clamp。dropBonus は luk 補正と天井 (0.95) を
    // **共有**するので、高 luk 職 (巫女=luk37) では既にドロップ率が高い素材で +0.1 の限界効用が逓減する
    // (青天井を防ぐ意図的な設計。数値は sim 前提の暫定値)。
    const chance = Math.min(0.95, d.chance + luk * BATTLE_TUNING.dropLukScale + dropBonus);
    if (rng() < chance) out.push(d.item);
  }
  return [...out, ...rollStoneDrops(monsterId, luk, seed, dropBonus)];
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

/** tier の敵が落とす魔石 (しらべるで見つかる地方素材の母集団。D-MATERIAL-001)。 */
function tierMaterials(tier: Tier): string[] {
  const set = new Set<string>();
  for (const m of MONSTERS) if (m.tier === tier && !m.storyOnly) set.add(STONE_IDS[monsterStoneElement(m)]);
  return [...set];
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
  { id: 'ten-wins', name: '駆け出しの挑戦者', description: '通算10勝', earned: (r) => r.wins >= 10 },
  { id: 'streak-5', name: '波に乗る者', description: '5連勝', earned: (r) => r.bestStreak >= 5 },
  { id: 'fifty-wins', name: '歴戦の空渡り', description: '通算50勝', earned: (r) => r.wins >= 50 },
  { id: 'streak-10', name: '不倒の旗印', description: '10連勝', earned: (r) => r.bestStreak >= 10 },
  { id: 'tier3-10', name: '真剣勝負の常連', description: '真剣勝負で10勝', earned: (r) => r.tier3Wins >= 10 },
  { id: 'hundred-wins', name: '蒼穹の覇者', description: '通算100勝', earned: (r) => r.wins >= 100 },
];

export function earnedTitles(r: BattleRecordSummary): TitleDef[] {
  return TITLES.filter((t) => t.earned(r));
}
