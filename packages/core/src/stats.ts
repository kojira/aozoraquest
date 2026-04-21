import { STATS, type Action, type Stat, type StatArray, type StatVector } from './types.js';

export const DECAY_HALF_LIFE_DAYS = 60;
export const MIN_STAT_VALUE = 5;
export const DAILY_CAP_PER_ACTION_TYPE = 5;

/** 空のステータスベクトル */
export function zeroStats(): StatVector {
  return { atk: 0, def: 0, agi: 0, int: 0, luk: 0 };
}

/** 加算 */
export function addStats(a: StatVector, b: StatVector): StatVector {
  return {
    atk: a.atk + b.atk,
    def: a.def + b.def,
    agi: a.agi + b.agi,
    int: a.int + b.int,
    luk: a.luk + b.luk,
  };
}

/** スカラー倍 */
export function scaleStats(v: StatVector, k: number): StatVector {
  return { atk: v.atk * k, def: v.def * k, agi: v.agi * k, int: v.int * k, luk: v.luk * k };
}

/**
 * アクションを時間減衰込みで集計し、生のステータスを計算する。
 * 半減期 DECAY_HALF_LIFE_DAYS。
 */
export function currentStatsRaw(actions: readonly Action[], now: number = Date.now()): StatVector {
  let acc = zeroStats();
  for (const a of actions) {
    const ageDays = (now - a.timestamp) / 86400000;
    const decay = Math.exp((-ageDays * Math.LN2) / DECAY_HALF_LIFE_DAYS);
    acc = addStats(acc, scaleStats(a.weights, decay));
  }
  return acc;
}

/** 床値 (各軸で最低 MIN_STAT_VALUE) を適用 */
export function applyFloor(v: StatVector): StatVector {
  const out: Partial<StatVector> = {};
  for (const s of STATS) out[s] = Math.max(MIN_STAT_VALUE, v[s]);
  return out as StatVector;
}

/**
 * 正規化 (合計 100)。
 * 入力が全 0 の場合は均等配分。
 */
export function normalizeStats(v: StatVector): StatVector {
  const total = STATS.reduce((s, k) => s + v[k], 0);
  if (total === 0) return { atk: 20, def: 20, agi: 20, int: 20, luk: 20 };
  const ratio = 100 / total;
  return {
    atk: Math.round(v.atk * ratio),
    def: Math.round(v.def * ratio),
    agi: Math.round(v.agi * ratio),
    int: Math.round(v.int * ratio),
    luk: Math.round(v.luk * ratio),
  };
}

/**
 * 日次上限適用: 同日・同アクション種別の 6 回目以降は weights=0 にする。
 */
export function capDailyActions(actions: readonly Action[]): Action[] {
  const byDay = new Map<string, Map<string, number>>();
  const result: Action[] = [];
  for (const a of actions) {
    const day = new Date(a.timestamp).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const counters = byDay.get(day)!;
    const count = counters.get(a.type) ?? 0;
    counters.set(a.type, count + 1);
    if (count >= DAILY_CAP_PER_ACTION_TYPE) {
      result.push({ ...a, weights: { atk: 0, def: 0, agi: 0, int: 0, luk: 0 } });
    } else {
      result.push(a);
    }
  }
  return result;
}

/** StatVector → 5 要素タプル (atk, def, agi, int, luk) */
export function toStatArray(v: StatVector): StatArray {
  return [v.atk, v.def, v.agi, v.int, v.luk] as const;
}

export function statAsArray(v: StatVector): [number, number, number, number, number] {
  return [v.atk, v.def, v.agi, v.int, v.luk];
}

/** 全体パイプライン: actions → 生データ → 床 → 正規化 */
export function computeStats(actions: readonly Action[], now: number = Date.now()): StatVector {
  const capped = capDailyActions(actions);
  const raw = currentStatsRaw(capped, now);
  const floored = applyFloor(raw);
  return normalizeStats(floored);
}

/** ステータスの差分ギャップ (目標 - 現在)、軸ごと */
export function statGap(current: StatVector, target: StatVector): StatVector {
  return {
    atk: target.atk - current.atk,
    def: target.def - current.def,
    agi: target.agi - current.agi,
    int: target.int - current.int,
    luk: target.luk - current.luk,
  };
}

/** 絶対ギャップが大きい順に Stat キーを返す */
export function sortStatsByAbsGap(gap: StatVector): readonly Stat[] {
  return [...STATS].sort((a, b) => Math.abs(gap[b]) - Math.abs(gap[a]));
}
