/**
 * 台本負けのストーリー戦 (scripted)。序盤の X 戦のように「負けて話が進む」戦闘。
 * - 主人公の HP は 0 にならない (1 で止まる)。止まったら、その場で lose で決着する
 * - 3 ターン目の終わりでも lose で決着する (強くて倒れなくても終わる)
 * - 検証: scripted は真偽値、loseFlag 必須、敵は 1 体だけ
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveTurn, setMonsterOverrides, setStory, startBattle, validateStory, StoryDataError,
  type MonsterDef, type StoryBattleDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const mon = (id: string, over: Partial<MonsterDef> = {}): MonsterDef => ({
  id, name: id, species: 'slime', level: 1, tier: 1, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over,
});
const MONS = [mon('a'), mon('b'), mon('c'),
  mon('crusher', { storyOnly: true, tier: 3, level: 99, hp: 9999, stats: [999, 999, 999, 1, 1] }),
  mon('pillow', { storyOnly: true, tier: 3, level: 1, hp: 9999, stats: [1, 999, 1, 1, 1] })];
const def = (over: Partial<StoryBattleDef> = {}): StoryBattleDef => ({
  id: 'b-x', monsterId: 'crusher', count: 1, winFlag: 'beat-x', loseFlag: 'lost-x', canFlee: false, scripted: true, ...over,
});
const start = (monsterId: string, scripted: boolean) =>
  startBattle('warrior', 5, 5, 'たびびと', 1, 42, 0, undefined, { monsterId, story: { canFlee: false, ...(scripted ? { scripted: true } : {}) } });

describe('台本負けのストーリー戦 (scripted)', () => {
  afterEach(() => { setStory(null); setMonsterOverrides(TEST_MONSTERS); });

  it('どれだけ強い一撃でも主人公の HP は 1 で止まり、その場で lose になる', () => {
    setMonsterOverrides(MONS);
    const s = start('crusher', true);
    expect(s.story).toEqual({ canFlee: false, scripted: true });
    const next = resolveTurn(s, 'attack');
    expect(next.player.hp).toBe(1);
    expect(next.outcome).toBe('lose');
  });

  it('倒れなくても 3 ターン目の終わりで lose になる', () => {
    setMonsterOverrides(MONS);
    let s = start('pillow', true);
    for (let t = 1; t <= 2; t++) { s = resolveTurn(s, 'guard'); expect(s.outcome).toBe('ongoing'); }
    s = resolveTurn(s, 'guard');
    expect(s.outcome).toBe('lose');
    expect(s.player.hp).toBeGreaterThan(0);
  });

  it('scripted でなければ今までどおり (HP 0 で lose、3 ターンで終わらない)', () => {
    setMonsterOverrides(MONS);
    expect(resolveTurn(start('crusher', false), 'attack').player.hp).toBe(0);
    let s = start('pillow', false);
    for (let t = 0; t < 3; t++) s = resolveTurn(s, 'guard');
    expect(s.outcome).toBe('ongoing');
  });

  it('検証: scripted は真偽値、loseFlag 必須、敵は 1 体だけ', () => {
    setMonsterOverrides(MONS);
    expect(() => validateStory({ battles: [def()] })).not.toThrow();
    const { loseFlag: _drop, ...noLose } = def();
    const bad = [noLose as StoryBattleDef, def({ count: 2 }), def({ scripted: 'yes' as unknown as boolean })];
    for (const b of bad) expect(() => validateStory({ battles: [b] })).toThrow(StoryDataError);
  });
});
