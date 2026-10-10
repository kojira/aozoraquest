import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '@aozoraquest/core';
import { doAttack, doMagic } from '@aozoraquest/core/src/battle-attack';
import { makeCombatant } from '@aozoraquest/core/src/battle-combatant';
import { STATUS_REGISTRY } from '@aozoraquest/core/src/statuses';
import { battleMessageLines, splitBattleLine } from './battle-message-lines';

// 文は packages/core が実際に作るものを使う (文言の写しをテストに持たない)。
const seq = (...xs: number[]) => () => xs.shift() ?? 0.5;
const fighters = () => [makeCombatant('ゆうしゃ', [30, 10, 10, 10, 10], 50, 10), makeCombatant('スライム', [10, 5, 5, 5, 5], 40, 0)] as const;

function attackText(rng: () => number): string {
  const [a, d] = fighters();
  const events: TurnEvent[] = [];
  doAttack(a, d, rng, events, 'player');
  return events[0]!.text;
}

describe('splitBattleLine', () => {
  it('こうげき と ダメージを 2 行に分ける', () => {
    const text = attackText(seq(0.99, 0.5, 0.99));
    expect(splitBattleLine(text)).toEqual(['ゆうしゃのこうげき!', expect.stringMatching(/^スライムに \d+ のダメージ$/)]);
  });
  it('会心「!!」は 2 行目の 頭に まとめて残す', () => {
    const text = attackText(seq(0.99, 0.5, 0));
    expect(text).toContain('会心の一撃!!');
    expect(splitBattleLine(text)).toEqual(['ゆうしゃのこうげき!', expect.stringMatching(/^会心の一撃!! スライムに \d+ のダメージ/)]);
  });
  it('回避「しかし」', () => {
    expect(splitBattleLine(attackText(seq(0)))).toEqual(['ゆうしゃのこうげき!', 'しかし スライムは身をかわした!']);
  });
  it('「の魔法!」', () => {
    const [a, d] = fighters();
    const events: TurnEvent[] = [];
    doMagic(a, d, seq(0.5), events, 'player', { amount: 7 });
    expect(splitBattleLine(events[0]!.text)).toEqual(['ゆうしゃの魔法!', 'スライムに 7 のダメージ']);
  });
  it('毒「…! N のダメージ」', () => {
    const [a] = fighters();
    const events: TurnEvent[] = [];
    STATUS_REGISTRY.poison.turnEnd!(a, { rng: seq(), events, status: { id: 'poison', turns: 2, magnitude: 3 } });
    expect(splitBattleLine(events[0]!.text)).toEqual(['ゆうしゃは毒のダメージ!', '3 のダメージ']);
  });
  it('割れ目の無い文は 1 行のまま', () => {
    expect(splitBattleLine('スライムには 効果がいまひとつのようだ…')).toEqual(['スライムには 効果がいまひとつのようだ…']);
    expect(splitBattleLine('スライムが あらわれた！ ぷるぷる')).toEqual(['スライムが あらわれた！ ぷるぷる']);
  });
  it('battleMessageLines はイベント順に 平らに並べる', () => {
    expect(battleMessageLines(['Aのこうげき! Bに 1 のダメージ', 'Bは ねむっている…'])).toEqual(['Aのこうげき!', 'Bに 1 のダメージ', 'Bは ねむっている…']);
  });
});
