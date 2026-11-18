import { describe, expect, it } from 'vitest';
import { startBattle, type BattleState } from '@aozoraquest/core';
import { stripState } from '../src/battle-encounter';

/** D-ENDGAME-001 PR4: ボスの型の位置 (どの列の何手め) は画面へ送らない。見えるのは前ぶれのログだけ。 */
describe('stripState はボスの型の位置を外す', () => {
  it('monster・enemies の pattern と weakDmg が画面へ出ない', () => {
    const s = startBattle('warrior', 5, 1, 'hero', 1, 3, 2);
    const cursor = { set: 0, pick: 1, step: 2, told: true };
    const withCursor: BattleState = { ...s, monster: { ...s.monster, pattern: cursor, weakDmg: 12 }, enemies: [{ ...s.monster, pattern: cursor, weakDmg: 12 }], allies: [s.player] };
    const out = JSON.stringify(stripState(withCursor));
    expect(out).not.toContain('"pattern"');
    expect(out).not.toContain('"weakDmg"');
    expect(out).not.toContain('"seed"');
  });
});
