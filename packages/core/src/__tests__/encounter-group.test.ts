/**
 * 群れ (D-PARTY-001 P4)。敵は全員本来の強さ。数は遭遇の seed で決め、確率は BATTLE_TUNING.groupChance だけ。
 * - t1 は 2 体まで (3 体は 0%)。t2 は 2/3 体、t3 以上は t3 の確率
 * - 群れを使えるようになる前 (open=false) は常に 1 体
 * - fleer・レア (spawnWeight<1) は群れに入らない (主敵がそうなら 1 体、追加の敵にも出ない)
 * - 同じ seed なら同じ群れ
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BATTLE_TUNING, encounterGroupSize, setMonsterOverrides, startBattle, MONSTERS_BY_ID, type MonsterDef } from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const mon = (id: string, tier: 1 | 2 | 3, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
const MONS = [mon('a', 1), mon('b', 1), mon('c', 1), mon('d', 2), mon('e', 2), mon('f', 3), mon('g', 3),
  mon('runner', 2, { ability: 'fleer' }), mon('rare', 2, { spawnWeight: 0.5 }), mon('runner3', 3, { abilities: ['healer', 'fleer'] })];
const count = (tier: 1 | 2 | 3 | 4, open = true, main = 'a') => {
  const n = [0, 0, 0, 0];
  for (let seed = 0; seed < 4000; seed++) n[encounterGroupSize(tier, seed, MONSTERS_BY_ID[main]!, open)]! += 1;
  return n.map((x) => x / 4000);
};

describe('encounterGroupSize', () => {
  afterEach(() => setMonsterOverrides(TEST_MONSTERS));

  it('t1 は 2 体が約 8%、3 体は 0%。t2・t3 は groupChance のとおり。t4 は t3 と同じ', () => {
    setMonsterOverrides(MONS);
    expect(BATTLE_TUNING.groupChance).toEqual({ 1: [0.08, 0], 2: [0.15, 0.03], 3: [0.25, 0.1] });
    const t1 = count(1);
    expect(t1[3]).toBe(0);
    expect(t1[2]).toBeGreaterThan(0.06); expect(t1[2]).toBeLessThan(0.1);
    const t2 = count(2, true, 'd');
    expect(t2[2]).toBeGreaterThan(0.13); expect(t2[2]).toBeLessThan(0.17);
    expect(t2[3]).toBeGreaterThan(0.02); expect(t2[3]).toBeLessThan(0.04);
    const t3 = count(3, true, 'f');
    expect(t3[3]).toBeGreaterThan(0.08); expect(t3[3]).toBeLessThan(0.12);
    expect(count(4, true, 'f')).toEqual(t3);
  });

  it('群れを使えるようになる前は常に 1 体', () => {
    setMonsterOverrides(MONS);
    expect(count(3, false, 'f')).toEqual([0, 1, 0, 0]);
  });

  it('主敵が fleer・レアなら 1 体', () => {
    setMonsterOverrides(MONS);
    for (const id of ['runner', 'rare']) expect(count(2, true, id)).toEqual([0, 1, 0, 0]);
    expect(count(3, true, 'runner3')).toEqual([0, 1, 0, 0]);
  });

  it('同じ seed なら同じ群れ (数も顔ぶれも)。追加の敵に fleer・レアは出ない', () => {
    setMonsterOverrides(MONS);
    let groups = 0;
    for (let seed = 0; seed < 400; seed++) {
      const a = startBattle('warrior', 8, 8, 'x', 2, seed, 0, undefined, { group: true });
      const b = startBattle('warrior', 8, 8, 'x', 2, seed, 0, undefined, { group: true });
      expect((a.enemies ?? [a.monster]).map((e) => [e.monsterId, e.maxHp])).toEqual((b.enemies ?? [b.monster]).map((e) => [e.monsterId, e.maxHp]));
      const n = encounterGroupSize(2, seed, MONSTERS_BY_ID[a.monsterId]!, true);
      expect(a.enemies?.length ?? 1).toBe(n);
      if (n > 1) groups++;
      for (const e of (a.enemies ?? []).slice(1)) expect(['runner', 'rare']).not.toContain(e.monsterId);
    }
    expect(groups).toBeGreaterThan(30);
  });

  it('group を渡さなければ今のまま 1 体 (monsterId 固定・extraEnemies も今のまま)', () => {
    setMonsterOverrides(MONS);
    for (let seed = 0; seed < 200; seed++) expect(startBattle('warrior', 8, 8, 'x', 3, seed).enemies).toBeUndefined();
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', group: true }).enemies).toBeUndefined();
    expect(startBattle('warrior', 8, 8, 'x', 3, 1, 0, undefined, { monsterId: 'f', extraEnemies: 2 }).enemies).toHaveLength(3);
  });
});
