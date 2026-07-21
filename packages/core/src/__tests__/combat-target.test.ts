import { describe, it, expect } from 'vitest';
import { resolveTargets, targetsEnemies, isSingleTarget, type CombatSides } from '../combat-target.js';
import { combatSides, startBattle } from '../index.js';
import type { Combatant } from '../battle.js';

let counter = 0;
function mk(name: string, hp = 10): Combatant {
  counter += 1;
  return {
    name,
    maxHp: 10,
    hp,
    maxMp: 5,
    mp: 5,
    atk: 10 + counter,
    def: 5,
    agi: 8,
    int: 8,
    luk: 8,
    guarding: false,
    parrying: false,
    charging: false,
    focus: 0,
    statuses: [],
    passives: [],
  };
}

describe('マルチ戦闘ターゲット解決 (#453)', () => {
  const a1 = mk('味方1');
  const a2 = mk('味方2');
  const e1 = mk('敵1');
  const e2 = mk('敵2');
  const sides: CombatSides = { allies: [a1, a2], enemies: [e1, e2] };

  it('self は生死問わず使用者自身', () => {
    expect(resolveTargets(a1, 'self', sides)).toEqual([a1]);
  });

  it('味方視点: oneEnemy=敵先頭 / allEnemies=敵全生存', () => {
    expect(resolveTargets(a1, 'oneEnemy', sides)).toEqual([e1]);
    expect(resolveTargets(a1, 'oneEnemy', sides, { targetIndex: 1 })).toEqual([e2]);
    expect(resolveTargets(a1, 'allEnemies', sides)).toEqual([e1, e2]);
  });

  it('味方視点: oneAlly/allAllies は味方陣', () => {
    expect(resolveTargets(a1, 'allAllies', sides)).toEqual([a1, a2]);
    expect(resolveTargets(a1, 'oneAlly', sides, { targetIndex: 1 })).toEqual([a2]);
  });

  it('敵視点は陣営が反転する (敵もとくぎを撃つ)', () => {
    // e1 が撃つと「味方=enemies / 敵=allies」。
    expect(resolveTargets(e1, 'oneEnemy', sides)).toEqual([a1]);
    expect(resolveTargets(e1, 'allAllies', sides)).toEqual([e1, e2]);
  });

  it('全滅した陣を狙うと空 (oneEnemy) / 生存者のみ (allEnemies)', () => {
    const dead: CombatSides = { allies: [a1], enemies: [mk('死1', 0), mk('生1', 5)] };
    expect(resolveTargets(a1, 'oneEnemy', dead)).toEqual([dead.enemies[1]]); // 死体はスキップ
    expect(resolveTargets(a1, 'allEnemies', dead)).toHaveLength(1);
  });

  it('ヘルパ: targetsEnemies / isSingleTarget', () => {
    expect(targetsEnemies('oneEnemy')).toBe(true);
    expect(targetsEnemies('allAllies')).toBe(false);
    expect(isSingleTarget('oneEnemy')).toBe(true);
    expect(isSingleTarget('allEnemies')).toBe(false);
  });

  it('combatSides: ソロ (配列未設定) は [player]/[monster] に退避 = 後方互換', () => {
    const s = startBattle('warrior', 5, 8, '戦', 1, 3, 0);
    const cs = combatSides(s);
    expect(cs.allies).toEqual([s.player]);
    expect(cs.enemies).toEqual([s.monster]);
    // ソロで oneEnemy を解決すると monster 単体。
    expect(resolveTargets(s.player, 'oneEnemy', cs)).toEqual([s.monster]);
    expect(resolveTargets(s.player, 'allEnemies', cs)).toEqual([s.monster]);
  });
});
