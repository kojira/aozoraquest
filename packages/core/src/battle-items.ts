/**
 * 戦闘で使うどうぐ (D-ITEM-001)。どうぐは「**1 回きりの MP のいらないとくぎ**」。
 * 効果は SkillEffect で書き、対象解決 (resolveTargets / effectTarget) とハンドラ (EFFECT_HANDLERS) は
 * とくぎと同じものを使う。1v1 (resolveTurn) と群れ (resolveTurnMulti) の両方がここを呼ぶ。
 */

import { EFFECT_HANDLERS, SKILLS, effectTarget, type SkillEffect } from './skills.js';
import { resolveTargets, type CombatSides, type SkillTarget } from './combat-target.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { ITEMS } from './battle-monsters.js';
import { type TurnEvent, type BattleState } from './battle-state.js';
import { doAttack, doMagic } from './battle-attack.js';
import { type Combatant } from './battle-combatant.js';

/** 戦闘で使えるどうぐか (world.items で battle の欄があるか)。 */
export function isBattleItem(id: string): boolean {
  return !!ITEMS[id]?.battle;
}

/** 手持ち (materials) から、戦闘で使えるどうぐの個数だけを写す (封印用)。上限は startBattle が切る。 */
export function battleItemsFrom(materials: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(materials)) if (n > 0 && isBattleItem(id)) out[id] = n;
  return out;
}

/** startBattle 用: 種類ごとに battleItemCarryMax までに切る (0 以下・戦闘で使えない品は落とす)。 */
export function carriedBattleItems(items: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(items ?? {})) {
    const c = Math.max(0, Math.min(BATTLE_TUNING.battleItemCarryMax, Math.floor(n)));
    if (c > 0 && isBattleItem(id)) out[id] = c;
  }
  return out;
}

/** どうぐの効果の対象。治療のどうぐ (cleanse の self) は「選んだ味方 1 人」(1 人戦は自分。D-PARTY-003)。
 *  どうぐを使うのは主人公だけなので、self = 主人公 だったものを、仲間にも使えるようにする。 */
export function itemEffectTarget(effect: SkillEffect): SkillTarget {
  if (effect.kind === 'cleanse' && effect.target === 'self') return 'oneAlly';
  return effectTarget(effect);
}

/** 味方 1 人を選んで使うとくぎか (聖光の癒し など。D-PARTY-003)。 */
export function skillTargetsOneAlly(kind: string): boolean {
  return !!SKILLS[kind]?.effects.some((e) => effectTarget(e) === 'oneAlly');
}

/** 味方 1 人を選んで使うどうぐか (やくそう・しずくは別のコマンド)。 */
export function itemTargetsOneAlly(itemId: string): boolean {
  return !!ITEMS[itemId]?.battle?.effects.some((e) => itemEffectTarget(e) === 'oneAlly');
}

/** そのどうぐを今この戦闘で使えるか (封印した持ち込み数が 1 以上で、戦闘用のどうぐ)。 */
export function canUseBattleItem(state: BattleState, itemId: string | undefined): itemId is string {
  return itemId !== undefined && (state.battleItems?.[itemId] ?? 0) > 0 && isBattleItem(itemId);
}

/** 使えないときの告知 (やくそうと同じく「たたかう」に落とす前に出す)。 */
export function missingBattleItemText(itemId: string | undefined): string {
  return `${(itemId && ITEMS[itemId]?.name) || 'どうぐ'}を もっていない!`;
}

/**
 * どうぐを 1 個使う。効果ごとに対象を解決してハンドラを呼び、持ち込み数を 1 減らす。
 * 呼ぶ前に canUseBattleItem で確かめること。使う人は user (省略は主人公 = allies[0])。
 */
export function useBattleItem(
  state: BattleState,
  itemId: string,
  sides: CombatSides,
  targetIndex: number,
  rng: () => number,
  events: TurnEvent[],
  allyIndex?: number,
  /** 使う人 (省略は主人公。めいれい の仲間も使う。D-PARTY-004)。 */
  user: Combatant = state.player,
): void {
  const def = ITEMS[itemId];
  const player = user;
  const name = def?.name ?? itemId;
  events.push({ actor: 'player', text: `${player.name}は ${name}を つかった!` });
  for (const raw of def?.battle?.effects ?? []) {
    const to = itemEffectTarget(raw);
    // cleanse のハンドラは self なら使う人を見るので、選んだ味方に向けた形で渡す。
    const effect: SkillEffect = raw.kind === 'cleanse' && to === 'oneAlly' ? { ...raw, target: 'oneAlly' } : raw;
    for (const target of resolveTargets(player, to, sides, { targetIndex, ...(allyIndex !== undefined ? { allyIndex } : {}) })) {
      const before = events.length;
      EFFECT_HANDLERS[effect.kind](effect, {
        attacker: player, defender: target, rng, events, skillName: name, actorSide: 'player', engine: { doAttack, doMagic },
      });
      // 状態付与が確率で外れると statusHandler は何も出さない。相手に効かなかったことを伝える。
      if (effect.kind === 'status' && effect.target !== 'self' && events.length === before && target.hp > 0) {
        events.push({ actor: 'player', text: `しかし ${target.name}には きかなかった!` });
      }
    }
  }
  const left = (state.battleItems?.[itemId] ?? 0) - 1;
  state.battleItems = { ...state.battleItems, [itemId]: Math.max(0, left) };
  state.battleItemsUsed = { ...state.battleItemsUsed, [itemId]: (state.battleItemsUsed?.[itemId] ?? 0) + 1 };
  events.push({ actor: 'player', text: `(のこり ${Math.max(0, left)})` });
}

/** 決着のとき: 戦闘で使ったやくそう・しずく・どうぐを手持ちから引く (0 以下は消す)。 */
export function materialsAfterBattleUse(
  materials: Readonly<Record<string, number>>,
  next: Pick<BattleState, 'herbsUsed' | 'tonicsUsed' | 'battleItemsUsed'>,
): Record<string, number> {
  const out = { ...materials };
  const used: Record<string, number> = { ...next.battleItemsUsed };
  used['herb'] = (used['herb'] ?? 0) + (next.herbsUsed ?? 0);
  used['sky-dew'] = (used['sky-dew'] ?? 0) + (next.tonicsUsed ?? 0);
  for (const [id, n] of Object.entries(used)) {
    if (!(n > 0)) continue;
    const left = (out[id] ?? 0) - n;
    if (left > 0) out[id] = left;
    else delete out[id];
  }
  return out;
}
