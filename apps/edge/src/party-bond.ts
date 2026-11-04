/**
 * 仲間との きずな を権威 state に足す (D-PARTY-004)。足し算は core の bondAfter 1 か所。
 * - 戦闘の決着: 封印した仲間 (sealed.party) 全員に +1 と、戦闘中にほかの人から受けた回復 (BattleState.healReceived)
 * - クエストの報告: その時パーティにいる全員に、本編 +10・それ以外 +5
 * ♥ が増えた人を返す (応答に載せ、画面が「ふかまった」を 1 行出す)。
 */
import { bondAfter, partyDefsOf, questBondPoints, recruitById, BOND_TUNING, type BattleState, type BondGain } from '@aozoraquest/core';
import type { PartyState } from './game-state';

/** ♥ が増えた仲間 (増えたあとの ♥ の数)。 */
export interface AllyBondUp { id: string; name: string; hearts: number }

export function partyWithBond(party: PartyState | undefined, gains: readonly BondGain[]): { party: PartyState | undefined; deepened: AllyBondUp[] } {
  if (!party || gains.length === 0) return { party, deepened: [] };
  const r = bondAfter(party, gains);
  const { bond: _b, bondHeal: _h, ...rest } = party;
  const next: PartyState = { ...rest, ...(r.bond ? { bond: r.bond } : {}), ...(r.bondHeal ? { bondHeal: r.bondHeal } : {}) };
  const names = partyDefsOf(next, recruitById, 1);
  const deepened = r.deepened.map((d) => ({ id: d.id, name: names.find((n) => n.id === d.id)?.name ?? '', hearts: d.hearts }));
  return { party: next, deepened };
}

/** 戦闘の決着: 出た仲間に +1 と、受けた回復ぶん。fought は allies[1..] の順。 */
export function partyWithBattleBond(party: PartyState | undefined, fought: readonly string[], battle: BattleState) {
  return partyWithBond(party, fought.map((id, i) => ({ id, points: BOND_TUNING.battle, healRatio: battle.healReceived?.[i + 1] ?? 0 })));
}

/** クエストの報告: いまパーティにいる全員に。 */
export function partyWithQuestBond(party: PartyState | undefined, questId: string) {
  const points = questBondPoints(questId);
  return partyWithBond(party, (party?.ids ?? []).map((id) => ({ id, points })));
}
