/**
 * ストーリー戦の定義とボス (D-STORY-009 PR2)。
 * - storyOnly のモンスターはランダム遭遇・「このあたり多い」・tier 判定・tier1 の頭数に出ない
 * - 戦闘定義の検証 (count 1〜3・winFlag 必須・敵の実在・固定モンスターの戦闘の実在)
 * - フラグ数は scenario.setFlags + placedItems.flag + battles.winFlag/loseFlag の合計で数える
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_FLAGS, MAX_POPULATED_TIER, favoredMonsterFor, flagsAfterStoryBattle, setMonsterOverrides, setStory, summonMonster,
  validateStory, StoryDataError, MonsterDataError, type MonsterDef, type ScenarioEvent, type StoryBattleDef,
} from '../index.js';
import { TEST_MONSTERS } from './helpers/monster-fixture.js';

const mon = (id: string, tier: 1 | 2 | 3, over: Partial<MonsterDef> = {}): MonsterDef => ({
  id, name: id, species: 'slime', level: 1, tier, stats: [7, 5, 6, 2, 4], hp: 5, drops: [], intro: 'て。', ...over,
});
const battle = (over: Partial<StoryBattleDef> = {}): StoryBattleDef => ({ id: 'b-boss', monsterId: 'boss', count: 1, winFlag: 'beat-boss', ...over });

describe('storyOnly のボス', () => {
  afterEach(() => { setStory(null); setMonsterOverrides(TEST_MONSTERS); });

  it('summonMonster / favoredMonsterFor / tier の判定に出ない。tier1 の 3 体にも数えない', () => {
    const tier1 = [mon('a', 1), mon('b', 1), mon('c', 1)];
    // tier2 は普通の敵 2 体 + ボス 1 体 → 「3 体そろった帯」にならない
    setMonsterOverrides([...tier1, mon('d', 2), mon('e', 2), mon('boss', 2, { storyOnly: true, spawnWeight: 1000 })]);
    expect(MAX_POPULATED_TIER).toBe(1);
    for (let seed = 0; seed < 200; seed++) expect(summonMonster(2, 5, seed).def.id).not.toBe('boss');
    for (let aff = 0; aff < 5; aff++) expect(favoredMonsterFor(2, aff)!.id).not.toBe('boss');
    expect(() => setMonsterOverrides([mon('a', 1), mon('b', 1), mon('boss', 1, { storyOnly: true })])).toThrow(MonsterDataError);
  });
});

describe('戦闘定義と固定モンスターの検証', () => {
  afterEach(() => { setStory(null); setMonsterOverrides(TEST_MONSTERS); });

  it('count は 1〜3・winFlag 必須・敵と戦闘の実在', () => {
    setMonsterOverrides([mon('a', 1), mon('b', 1), mon('c', 1), mon('boss', 2, { storyOnly: true })]);
    expect(() => validateStory({ battles: [battle({ count: 3 })] })).not.toThrow();
    for (const bad of [battle({ count: 0 }), battle({ count: 4 }), battle({ winFlag: '' }), battle({ monsterId: 'nope' })]) {
      expect(() => validateStory({ battles: [bad] })).toThrow(StoryDataError);
    }
    expect(() => validateStory({ battles: [battle()], fieldMonsters: [{ id: 'fm', mapId: 'world', x: 1, y: 1, battleId: 'missing' }] })).toThrow(StoryDataError);
  });

  it('フラグ数は シナリオ・置きアイテム・戦闘の勝ち負けフラグを合わせて数える', () => {
    setMonsterOverrides([mon('a', 1), mon('b', 1), mon('c', 1), mon('boss', 2, { storyOnly: true })]);
    const events: ScenarioEvent[] = [{ id: 'e', title: 't', when: [], setFlags: Array.from({ length: MAX_FLAGS - 1 }, (_, i) => `s${i}`) }];
    expect(() => validateStory({ battles: [battle({ winFlag: 'w' })] }, events)).not.toThrow();
    expect(() => validateStory({ battles: [battle({ winFlag: 'w', loseFlag: 'l' })] }, events)).toThrow(StoryDataError);
  });

  it('決着のフラグ: win は winFlag、lose は loseFlag だけ、逃げは何も立てない', () => {
    const b = battle({ loseFlag: 'lost-boss' });
    expect(flagsAfterStoryBattle(b, 'win', [])).toEqual(['beat-boss']);
    expect(flagsAfterStoryBattle(b, 'lose', [])).toEqual(['lost-boss']);
    expect(flagsAfterStoryBattle(b, 'fled', ['x'])).toEqual(['x']);
    expect(flagsAfterStoryBattle(battle(), 'lose', [])).toEqual([]);
  });
});
