/**
 * 効かない状態異常 (MonsterDef.statusResist。docs/25 §12・D-PARTY-002 §12 のボスの糸口)。
 * - 並べた状態は付与されず「しかし 〇〇には きかなかった!」。並べていない状態は今までどおり効く
 * - 検証: 知らない状態・重複は弾く
 */
import { afterEach, describe, expect, it } from 'vitest';
import { activeEquipment, activeItems, resolveTurn, setItemOverrides, setMonsterOverrides, startBattle, type ItemDefData, type MonsterDef } from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const NEMURI: ItemDefData = { id: 'nemuri-kona', name: 'ねむりごな', battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 1, turns: 3 }] } };
const SHIBIRE: ItemDefData = { id: 'shibire-bari', name: 'しびればり', battle: { effects: [{ kind: 'status', status: 'stun', target: 'enemy', chance: 1, turns: 1 }] } };
const BOSS: MonsterDef = { id: 'rboss', name: 'いわのぬし', species: 'golem', level: 5, tier: 1, stats: [5, 5, 5, 5, 5], hp: 999, drops: [], intro: 'いわのぬしが あらわれた。', statusResist: ['sleep'] };

afterEach(() => { setItemOverrides(null); setMonsterOverrides(TEST_MONSTERS); });
function battle(): ReturnType<typeof startBattle> {
  setMonsterOverrides([...TEST_MONSTERS, BOSS]);
  setItemOverrides({ items: [...activeItems().filter((i) => i.id !== NEMURI.id && i.id !== SHIBIRE.id), NEMURI, SHIBIRE], equipment: [...activeEquipment()] });
  return startBattle('warrior', 5, 5, '勇者', 1, 3, 0, undefined, { battleItems: { 'nemuri-kona': 1, 'shibire-bari': 1 }, monsterId: 'rboss' });
}
const has = (c: { statuses?: { id: string }[] }, id: string) => (c.statuses ?? []).some((s) => s.id === id);

describe('statusResist', () => {
  it('並べた状態 (眠り) は付与されず「きかなかった」。並べていない状態 (麻痺) は効く', () => {
    const s0 = battle();
    const s1 = resolveTurn(s0, 'item', 1, 0, 'nemuri-kona');
    expect(has(s1.monster, 'sleep')).toBe(false);
    expect(s1.lastEvents.filter((e) => e.text === `しかし ${s0.monster.name}には きかなかった!`)).toHaveLength(1);
    expect(s1.lastEvents.some((e) => e.text.endsWith('は眠ってしまった!'))).toBe(false);
    expect(has(resolveTurn(battle(), 'item', 1, 0, 'shibire-bari').monster, 'stun')).toBe(true);
  });

  it('検証: 知らない状態・重複は弾く', () => {
    expect(() => setMonsterOverrides([...TEST_MONSTERS, { ...BOSS, statusResist: ['nope' as never] }])).toThrow(/statusResist/);
    expect(() => setMonsterOverrides([...TEST_MONSTERS, { ...BOSS, statusResist: ['sleep', 'sleep'] }])).toThrow(/statusResist/);
    expect(() => setMonsterOverrides([...TEST_MONSTERS, { ...BOSS, statusResist: ['sleep', 'poison'] }])).not.toThrow();
  });
});
