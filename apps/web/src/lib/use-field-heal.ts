import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Agent } from '@atproto/api';
import { partyDefsOf, partyMemberCombatant, recruitById, type Archetype, type Combatant } from '@aozoraquest/core';
import { serverFieldSkill, serverItem, type ServerParty, type ServerSkillResult } from '@/lib/world-server';
import type { FieldMember } from '@/components/field-skill-modal';
import type { WorldInventory } from '@/lib/use-world-inventory';
import type { Vitals } from '@/lib/world-view';
import { bondUpLines } from '@/lib/bond-view';

const newRkey = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 主人公 ('hero') と仲間 (入れている順) を、持ちこしの HP/MP つきで (D-PARTY-003)。hero は戦闘と同じ組み立ての combat。 */
export function fieldMembers(hero: Combatant | null, heroJob: { archetype: Archetype; level: number } | null, ws: Vitals | null, party: ServerParty): FieldMember[] {
  if (!hero || !heroJob) return [];
  const h: Combatant = { ...hero, name: hero.name || 'あなた', hp: Math.min(ws?.hp ?? hero.maxHp, hero.maxHp), mp: Math.min(ws?.mp ?? hero.maxMp, hero.maxMp), job: heroJob };
  const carry = { ...(party.hp ? { hp: party.hp } : {}), ...(party.mp ? { mp: party.mp } : {}) };
  return [{ id: 'hero', c: h }, ...partyDefsOf(party, recruitById, heroJob.level).map((d) => ({ id: d.id, c: partyMemberCombatant(d, heroJob.level, carry) }))];
}

/**
 * フィールドの回復 (D-PARTY-003): 回復のとくぎ と、やくそう・しずくを仲間に。確かめと書き込みはサーバー (応答で表示を合わせる)。
 * 主人公だけのやくそう・しずくは今までどおり useWorldFieldItems。
 */
export function useFieldHeal({ agent, inventory, setWs, setParty }: {
  agent: Agent | null;
  inventory: WorldInventory;
  setWs: Dispatch<SetStateAction<Vitals | null>>;
  setParty: (p: ServerParty) => void;
}) {
  const applyVitals = useCallback((r: { carryHp?: number | undefined; carryMp?: number | undefined; party?: ServerParty | undefined }) => {
    setWs((s) => (s ? { ...s, hp: r.carryHp ?? null, mp: r.carryMp ?? null } : s));
    // 仲間の持ちこしは応答の party を正にする (edge は満タンを書かないので、全快の人は hp/mp から消える)。
    if (r.party) setParty(r.party);
  }, [setParty, setWs]);

  const castFieldSkill = useCallback(async (caster: string, skillId: string, target: string | undefined): Promise<ServerSkillResult> => {
    if (!agent) throw new Error('サーバーに つながらない');
    const r = await serverFieldSkill(agent, caster, skillId, target, newRkey());
    applyVitals(r);
    return r;
  }, [agent, applyVitals]);

  /** やくそう・しずくを仲間に使う。結果の 1 文を返す (窓に出す)。 */
  const itemOnAlly = useCallback(async (item: 'herb' | 'tonic', ally: FieldMember): Promise<string> => {
    if (!agent) return 'サーバーに つながらない';
    try {
      const r = await serverItem(agent, item, ally.id);
      inventory.applyServerMaterials(r.materials);
      applyVitals(r);
      const said = item === 'herb' ? `${ally.c.name}に やくそうを使った! HPが${r.healed}回復。` : `${ally.c.name}に そらのしずくを使った! MPが${r.healed}回復。`;
      return [said, ...bondUpLines(r.allyBondUp)].join(' ');
    } catch (e) {
      return e instanceof Error && e.message ? e.message : 'つかえなかった (通信エラー)。';
    }
  }, [agent, applyVitals, inventory]);

  return { castFieldSkill, itemOnAlly };
}
