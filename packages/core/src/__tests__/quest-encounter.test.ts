/**
 * 受注中の討伐依頼の敵を、依頼の地方で出やすくする (D-EARLY-001)。
 * - 依頼主の街と同じリージョンだけ。数がそろった依頼・ほかの地方の依頼は効かない
 * - 5 体の依頼が 1 人でおよそ 8〜12 戦 (相性の ×3 が別の敵を指していても)
 * - レア・逃げる敵は出やすくならない。同じ seed なら同じ敵
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  questEncounterFocus, npcFieldPosition, regionOf, setGameQuests, setInteriors, setNpcs, setMonsterOverrides, startBattle, summonMonster,
  type GameQuestDef, type MonsterDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({ id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over });
// tier1 が 9 種 (dev と同じ数)。rare はレア、runner は逃げる敵。
const POOL = ['a', 'b', 'c', 'd', 'e', 'f', 'target', 'g'].map((id) => mon(id));
const MONS = [...POOL, mon('rare', { spawnWeight: 0.4 }), mon('runner', { ability: 'fleer' })];

const TOWN = { x: 320, y: 448 }; // フィールドの街の座標 (region 26)
const town = { id: 'test-town', name: 'まち', size: 4, tiles: new Uint8Array(16), exitTo: { mapId: 'world', x: TOWN.x, y: TOWN.y + 1 } };
const quest = (id: string, monsterId: string, npcId = 'elder', count = 5): GameQuestDef => ({ id, title: id, npcId, intro: ['た'], done: ['あ'], objective: { kind: 'defeat', monsterId, count } });

function setup() {
  setMonsterOverrides(MONS);
  setInteriors([town], []);
  setNpcs([
    { id: 'elder', name: 'まちおさ', mapId: 'test-town', x: 1, y: 1, lines: ['や'] },
    { id: 'far', name: 'とおく', x: 10, y: 10, lines: ['や'] },
  ]);
  setGameQuests([quest('q-target', 'target'), quest('q-far', 'target', 'far'), quest('q-rare', 'rare'), quest('q-runner', 'runner'), quest('q-b', 'b')]);
}
const REGION = regionOf(TOWN.x, TOWN.y);
const share = (id: string, focus: string[] | undefined, affinity?: number, N = 6000) => {
  let n = 0;
  for (let seed = 1; seed <= N; seed++) if (summonMonster(1, 1, Math.imul(seed, 2654435761) >>> 0, 1, affinity, 0, undefined, focus).def.id === id) n++;
  return n / N;
};

describe('questEncounterFocus / summonMonster の focus', () => {
  afterEach(() => { setGameQuests(null); setNpcs(null); setInteriors(null, null); setMonsterOverrides(TEST_MONSTERS); });

  it('内部マップの依頼主は、出口のフィールドの座標の街で数える', () => {
    setup();
    expect(npcFieldPosition({ mapId: 'test-town', x: 1, y: 1 })).toEqual({ x: TOWN.x, y: TOWN.y + 1 });
    expect(npcFieldPosition({ x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });

  it('依頼主の街のリージョンでだけ、数がそろっていない討伐依頼の敵を返す', () => {
    setup();
    expect(questEncounterFocus([{ id: 'q-target', progress: 2 }], REGION)).toEqual(['target']);
    expect(questEncounterFocus([{ id: 'q-target', progress: 5 }], REGION)).toEqual([]);
    expect(questEncounterFocus([{ id: 'q-target', progress: 0 }], REGION + 1)).toEqual([]);
    expect(questEncounterFocus([{ id: 'q-far', progress: 0 }], REGION)).toEqual([]);
    expect(questEncounterFocus([], REGION)).toEqual([]);
  });

  it('5 体の依頼が 1 人でおよそ 8〜12 戦: 相性がほかの敵を指していても、依頼の敵が 4〜6 割', () => {
    setup();
    const before = share('target', undefined);
    expect(before).toBeLessThan(0.15);
    for (const affinity of [0, 1, 6]) { // 6 = target 自身を指す
      const p = share('target', ['target'], affinity);
      expect(p, `affinity ${affinity}`).toBeGreaterThan(0.4);
      expect(p, `affinity ${affinity}`).toBeLessThan(0.6);
      expect(5 / p).toBeGreaterThanOrEqual(8);
      expect(5 / p).toBeLessThanOrEqual(12.5);
    }
  });

  it('レア・逃げる敵・プールにいない敵は出やすくならない', () => {
    setup();
    expect(share('rare', ['rare'])).toBeCloseTo(share('rare', undefined), 5);
    expect(share('runner', ['runner'])).toBeCloseTo(share('runner', undefined), 5);
    expect(share('target', ['not-in-pool'])).toBeCloseTo(share('target', undefined), 5);
  });

  it('同じ地方で 2 つの討伐依頼を受けても、ほかの敵も出つづける', () => {
    setup();
    const pt = share('target', ['target', 'b']);
    const pb = share('b', ['target', 'b']);
    expect(pt + pb).toBeLessThanOrEqual(0.82);
    expect(pt).toBeGreaterThan(0.3);
    expect(pb).toBeGreaterThan(0.3);
  });

  it('同じ seed なら同じ敵 (startBattle の主敵も群れも決定的)', () => {
    setup();
    for (let seed = 1; seed < 50; seed++) {
      const a = startBattle('warrior', 1, 1, 'p', 1, seed, 0, undefined, { focus: ['target'], group: { partySize: 2 } });
      const b = startBattle('warrior', 1, 1, 'p', 1, seed, 0, undefined, { focus: ['target'], group: { partySize: 2 } });
      expect(a.monsterId).toBe(b.monsterId);
      expect((a.enemies ?? []).map((e) => e.name)).toEqual((b.enemies ?? []).map((e) => e.name));
    }
  });
});
