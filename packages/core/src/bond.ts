/**
 * 仲間との きずな (D-PARTY-004)。上がり方は 3 つだけで、足し算はここ (bondAfter) 1 か所。
 * - いっしょに戦う: 戦闘に出た仲間に、決着ごとに +1 (勝ち・負け・にげる すべて)
 * - 回復を受ける: ほかの人から実際に戻った HP の、最大 HP の 25% ごとに +1 (端数は bondHeal に千分率で持ちこす)。
 *   自分で自分を回復したぶん・あふれたぶんは数えない
 * - クエスト達成: その時パーティにいる全員に、本編 +10・それ以外 +5。本編 = シナリオの条件 questDone に出てくるクエスト
 * 段階は ♥1 = 20・♥2 = 60・♥3 = 150 (上限。減らない)。きずなで能力値は変わらない。
 */
import { scenarioEvents } from './scenario.js';
import type { BattleState } from './battle-state.js';
import type { Combatant } from './battle-combatant.js';

export const BOND_TUNING = {
  max: 150,
  /** ♥1・♥2・♥3 になる きずな。 */
  hearts: [20, 60, 150],
  battle: 1,
  mainQuest: 10,
  sideQuest: 5,
  /** 回復で +1 になる、受けた HP の最大 HP に対する割合 (千分率で数える)。 */
  healStepPermille: 250,
} as const;

/** きずなの ♥ の数 (0〜3)。 */
export function bondHearts(bond: number | undefined): number {
  return BOND_TUNING.hearts.filter((h) => (bond ?? 0) >= h).length;
}

/** 保存しているきずな (edge の PartyState の一部)。 */
export interface BondRecord {
  ids: readonly string[];
  bond?: Readonly<Record<string, number>>;
  bondHeal?: Readonly<Record<string, number>>;
}

/** 1 人ぶんの上がり。points はそのまま足す点、healRatio はほかの人から戻った HP ÷ 最大 HP の合計。 */
export interface BondGain {
  id: string;
  points?: number;
  healRatio?: number;
}

export interface BondResult {
  bond?: Record<string, number>;
  bondHeal?: Record<string, number>;
  /** ♥ が増えた人 (増えたあとの ♥ の数)。 */
  deepened: Array<{ id: string; hearts: number }>;
}

/** きずなを足す (純関数)。ids にいない人は数えない。上限 150 で止まる。 */
export function bondAfter(rec: BondRecord, gains: readonly BondGain[]): BondResult {
  const bond: Record<string, number> = { ...rec.bond };
  const heal: Record<string, number> = { ...rec.bondHeal };
  const deepened: BondResult['deepened'] = [];
  for (const g of gains) {
    if (!rec.ids.includes(g.id)) continue;
    const before = bond[g.id] ?? 0;
    const permille = (heal[g.id] ?? 0) + Math.max(0, Math.round((g.healRatio ?? 0) * 1000));
    const fromHeal = Math.floor(permille / BOND_TUNING.healStepPermille);
    const rest = permille % BOND_TUNING.healStepPermille;
    if (rest > 0) heal[g.id] = rest; else delete heal[g.id];
    const after = Math.min(BOND_TUNING.max, before + Math.max(0, Math.floor(g.points ?? 0)) + fromHeal);
    if (after > 0) bond[g.id] = after;
    if (bondHearts(after) > bondHearts(before)) deepened.push({ id: g.id, hearts: bondHearts(after) });
  }
  return {
    ...(Object.keys(bond).length ? { bond } : {}),
    ...(Object.keys(heal).length ? { bondHeal: heal } : {}),
    deepened,
  };
}

/** 本編のクエストか (シナリオの条件 questDone に出てくる)。 */
export function isMainQuest(questId: string): boolean {
  return scenarioEvents().some((e) => e.when.some((c) => c.kind === 'questDone' && c.questId === questId));
}

/** クエスト達成で全員に足す点。 */
export function questBondPoints(questId: string): number {
  return isMainQuest(questId) ? BOND_TUNING.mainQuest : BOND_TUNING.sideQuest;
}

/** 戦闘の回復の記録。味方 actor が動く前に呼び、動いたあとに返り値を呼ぶ。ほかの味方の HP が増えたぶん
 *  (とくぎ・やくそう・どうぐ。あふれたぶんは増えない) を state.healReceived[味方の位置] に 戻った HP ÷ 最大 HP で足す。
 *  自分で自分を回復したぶんは数えない。 */
export function watchHeals(state: BattleState, allies: readonly Combatant[], actor: Combatant): () => void {
  const before = allies.map((a) => a.hp);
  return () => {
    allies.forEach((a, i) => {
      const restored = a.hp - before[i]!;
      if (a === actor || restored <= 0 || a.maxHp <= 0) return;
      const got = [...(state.healReceived ?? [])];
      while (got.length <= i) got.push(0);
      got[i] = got[i]! + restored / a.maxHp;
      state.healReceived = got;
    });
  };
}
