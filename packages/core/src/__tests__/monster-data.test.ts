import { describe, it, expect, afterEach } from 'vitest';
import {
  setMonsterOverrides,
  hasMonsterOverrides,
  monsterCountByTier,
  MonsterDataError,
  MONSTERS,
  MONSTERS_BY_ID,
  MAX_POPULATED_TIER,
  battleXpFor,
  startBattle,
  runAutoBattle,
  type MonsterDef,
} from '../index.js';
import * as core from '../index.js';

/**
 * **モンスターをレコードで差し替える** (#419 / #537)。
 *
 * ここで固定するのは 3 つ:
 *  - 差し替えると MONSTERS / MONSTERS_BY_ID / MAX_POPULATED_TIER / 戦闘 の**全部**に効く
 *    (参照を保ったまま中身を入れ替えるので、既存の import 先も新しい敵を見る)
 *  - 解除でコード直書きへ**完全に戻る** (戻らないと他のテストを汚染する)
 *  - **壊れた 1 体で全体を落とす** (部分適用しない)
 */
const base = (over: Partial<MonsterDef> = {}): MonsterDef => ({
  id: 'test-slime',
  name: 'てすとスライム',
  species: 'slime',
  level: 1,
  tier: 1,
  stats: [7, 5, 6, 2, 4],
  hp: 5,
  drops: [],
  intro: 'てすと。',
  ...over,
});

const trio = (tier: 1 | 2 | 3 | 4, prefix: string): MonsterDef[] =>
  [0, 1, 2].map((i) => base({ id: `${prefix}-${i}`, name: `${prefix}${i}`, tier }));

describe('モンスターのレコード差し替え (#419)', () => {
  afterEach(() => setMonsterOverrides(null));

  it('差し替えると一覧・辞書・戦闘の全部に効き、解除で完全に戻る', () => {
    const originalCount = MONSTERS.length;
    const originalIds = MONSTERS.map((m) => m.id);

    setMonsterOverrides([...trio(1, 'a'), base({ id: 'boss', name: 'ぼす', tier: 1, hp: 9, xp: 42 })]);
    expect(hasMonsterOverrides()).toBe(true);
    expect(MONSTERS).toHaveLength(4);
    expect(MONSTERS_BY_ID['boss']?.name).toBe('ぼす');
    expect(MONSTERS_BY_ID[originalIds[0]!]).toBeUndefined();
    expect(battleXpFor('boss')).toBe(42);
    // 戦闘も新しい敵で回る
    const r = runAutoBattle(startBattle('warrior', 5, 1, 'x', 1, 7, 0, undefined, { monsterId: 'boss' }));
    expect(['win', 'lose', 'draw', 'fled', 'monster-fled']).toContain(r.outcome);

    setMonsterOverrides(null);
    expect(hasMonsterOverrides()).toBe(false);
    expect(MONSTERS).toHaveLength(originalCount);
    expect(MONSTERS.map((m) => m.id)).toEqual(originalIds);
  });

  it('MAX_POPULATED_TIER が追従する (敵を足せば上の帯が解放される)', () => {
    // live binding なので import 側から再読して確かめる
    const before = core.MAX_POPULATED_TIER;
    expect(before).toBe(3); // 現状 tier4 以上は 3 体未満
    setMonsterOverrides([...trio(1, 'a'), ...trio(2, 'b'), ...trio(3, 'c'), ...trio(4, 'd')]);
    expect(core.MAX_POPULATED_TIER).toBe(4);
    setMonsterOverrides(null);
    expect(core.MAX_POPULATED_TIER).toBe(before);
    void MAX_POPULATED_TIER; // 直接 import した束縛はモジュールの再読で更新される (ESM)
  });

  it('壊れた 1 体で全体を落とす (部分適用しない)', () => {
    const beforeCount = MONSTERS.length;
    const bad = [...trio(1, 'a'), base({ id: 'a-0' })]; // id 重複
    expect(() => setMonsterOverrides(bad)).toThrow(MonsterDataError);
    expect(MONSTERS).toHaveLength(beforeCount); // 何も変わっていない
    expect(hasMonsterOverrides()).toBe(false);

    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', hp: 0 })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', stats: [1, 2, 3] as never })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', ability: 'caster' })])).toThrow(MonsterDataError); // spell なし
    expect(() => setMonsterOverrides([...trio(1, 'a'), base({ id: 'x', drops: [{ item: 'slime-drop', chance: 2 }] })])).toThrow(MonsterDataError);
  });

  it('**tier1 が 3 体を下回る差し替えは拒否** (遭遇が壊れて街から出られなくなる)', () => {
    expect(() => setMonsterOverrides([base({ id: 'only' })])).toThrow(MonsterDataError);
    expect(() => setMonsterOverrides([base({ id: 'a' }), base({ id: 'b' })])).toThrow(MonsterDataError);
    // ちょうど 3 体なら通る
    expect(() => setMonsterOverrides(trio(1, 'ok'))).not.toThrow();
  });

  it('tier ごとの頭数を数えられる (エディタの検証表示用)', () => {
    setMonsterOverrides([...trio(1, 'a'), ...trio(2, 'b')]);
    expect(monsterCountByTier()).toEqual({ 1: 3, 2: 3 });
  });
});
