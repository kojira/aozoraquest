/**
 * **貴重な装備の保存の検査** (D-RARE-GEAR-001)。店に出さない きまり そのものは shopForbiddenDef (revive.ts) の 1 か所。
 * ここは、データを書く前 (edge の管理 API・管理画面) に止める検査だけ。読み込みでは止めない (古いデータで世界を落とさない)。
 *
 * 1. 貴重な装備の値札は 0 (price.power 0)
 * 2. 店の上書き・魔石の交換に、店に出さない装備が無い
 * 3. 敵の gearDrop は、ある貴重な装備を指す
 * 4. クエストの報酬の装備・選べる品は、ある品で、カジノの景品でない
 * 5. 選べる品の組は、16 職のどれもが 1 品以上 装備できる
 * 6. grade N の貴重な装備は、どの値も grade N+1 の同じ部位の店の品 (の いちばん高い値) に届かない
 */
import { EQUIPMENT, canEquip, type EquipmentDef } from './equipment.js';
import { MONSTERS, type MonsterDef } from './battle-monsters.js';
import { gameQuests, type GameQuestDef } from './quest-data.js';
import { shopOverrides } from './shop-data.js';
import { shopForbiddenDef } from './revive.js';
import { ARCHETYPES } from './types.js';

export interface PreciousCheckInput {
  equipment?: readonly EquipmentDef[];
  monsters?: readonly MonsterDef[];
  quests?: readonly GameQuestDef[];
}

/** 最初に見つかった問題 (無ければ null)。渡さなかったものは今 読み込まれている値で見る。 */
export function preciousIssue(input: PreciousCheckInput = {}): string | null {
  const equipment = input.equipment ?? EQUIPMENT;
  const byId = new Map(equipment.map((e) => [e.id, e]));
  for (const e of equipment) {
    if (e.precious && e.price.power !== 0) return `${e.id}: 貴重な装備の値札は 0 にする (price.power ${e.price.power})`;
    const ladder = preciousLadderIssue(e, equipment);
    if (ladder) return ladder;
  }
  for (const s of shopOverrides()) {
    for (const id of [...(s.equipment ?? []), ...(s.exchange ?? []).map((x) => x.equipmentId)]) {
      const def = id ? byId.get(id) : undefined;
      if (def && shopForbiddenDef(def)) return `店 (${s.x}, ${s.y}) に 店に出さない装備がある (${id})`;
    }
  }
  for (const m of input.monsters ?? MONSTERS) {
    const g = m.gearDrop;
    if (g && !byId.get(g.equipment)?.precious) return `${m.id}: まれなドロップは貴重な装備にする (${g.equipment})`;
  }
  for (const q of input.quests ?? gameQuests()) {
    for (const id of [q.reward?.equipment, ...(q.reward?.choices ?? [])]) {
      if (id === undefined) continue;
      const def = byId.get(id);
      if (!def) return `${q.id}: 報酬の装備が存在しない (${id})`;
      if (def.casinoOnly) return `${q.id}: カジノの景品は報酬にできない (${id})`;
    }
    const choices = (q.reward?.choices ?? []).map((id) => byId.get(id)!);
    if (choices.length > 0) {
      const none = ARCHETYPES.find((a) => !choices.some((e) => canEquip(a, e)));
      if (none) return `${q.id}: 選べる品に ${none} が装備できる品が無い`;
    }
  }
  return null;
}

/** grade N の貴重な装備が、grade N+1 の同じ部位の店の品に届いていないか (値ごとに、N+1 の いちばん高い値と比べる)。 */
function preciousLadderIssue(e: EquipmentDef, equipment: readonly EquipmentDef[]): string | null {
  if (!e.precious) return null;
  const next = equipment.filter((x) => x.grade === e.grade + 1 && x.slot === e.slot && !shopForbiddenDef(x));
  for (const [k, v] of Object.entries(e.bonus)) {
    const top = Math.max(0, ...next.map((x) => x.bonus[k as keyof EquipmentDef['bonus']] ?? 0));
    if (top > 0 && (v ?? 0) >= top) return `${e.id}: ${k} ${v} が 1 つ上の段 (grade ${e.grade + 1}) の${e.slot}の ${top} に届いている`;
  }
  return null;
}
