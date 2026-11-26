/**
 * **クエストの報酬の装備** (D-RARE-GEAR-001)。本編の節目の 1 品 (reward.equipment) と、
 * 長いサイドストーリーの最後に 1 つ選ぶ品 (reward.choices)。
 * web (選ぶ画面) と edge (選んだ品を確かめて渡す) が同じ questRewardChoices を使う。
 */
import { EQUIPMENT_BY_ID, canEquip } from './equipment.js';
import type { GameQuestDef } from './quest-data.js';
import type { Archetype } from './types.js';

/**
 * 選べる品のうち、主人公か今の仲間のだれかが装備できる品 (id)。主人公が装備できる品を先に並べる (同じ組の中は定義の順)。
 * archetypes[0] = 主人公、残り = 今の仲間。無い品は出さない。
 */
export function questRewardChoices(def: Pick<GameQuestDef, 'reward'>, archetypes: readonly Archetype[]): string[] {
  const [hero, ...mates] = archetypes;
  const defs = (def.reward?.choices ?? []).map((id) => EQUIPMENT_BY_ID[id]).filter((e) => !!e);
  const heroFit = defs.filter((e) => hero !== undefined && canEquip(hero, e));
  const mateFit = defs.filter((e) => !heroFit.includes(e) && mates.some((a) => canEquip(a, e)));
  return [...heroFit, ...mateFit].map((e) => e.id);
}

/** 報酬に装備があるクエストか (渡す前に持ち物の空きを確かめる)。 */
export function questGivesEquipment(def: Pick<GameQuestDef, 'reward'>): boolean {
  return !!def.reward?.equipment || !!def.reward?.choices?.length;
}

/** 持ち物に入れる装備の rkey (クエスト 1 つに 1 品。決まった値なので再送で二重に入らない)。 */
export function questPieceRkey(questId: string): string {
  return `quest-${questId}`;
}
