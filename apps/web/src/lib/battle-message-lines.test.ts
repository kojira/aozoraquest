import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '@aozoraquest/core';
import { doAttack, doMagic } from '@aozoraquest/core/src/battle-attack';
import { makeCombatant } from '@aozoraquest/core/src/battle-combatant';
import { STATUS_REGISTRY } from '@aozoraquest/core/src/statuses';
import { battleLineHps, battleMessageLines, splitBattleLine } from './battle-message-lines';

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

describe('battleLineHps (#764)', () => {
  const before = { player: 30, monsters: [30] };
  const final = { player: 22, monsters: [27] };
  const events: TurnEvent[] = [
    { actor: 'player', text: 'Aのこうげき! Bに 3 のダメージ', damage: 3, hp: { player: 30, monsters: [27] } },
    { actor: 'monster', text: 'Bのこうげき! Aに 8 のダメージ', damage: 8, hp: { player: 22, monsters: [27] } },
  ];
  it('ダメージの 行 (分割の 後半) で その イベントの hp に 変わる', () => {
    expect(battleLineHps(events, before, final)).toEqual([before, { player: 30, monsters: [27] }, { player: 30, monsters: [27] }, final]);
  });
  it('hp の 無い 旧応答は 最後の 行まで before', () => {
    const old = events.map(({ hp: _hp, ...e }) => e);
    expect(battleLineHps(old, before, final)).toEqual([before, before, before, final]);
  });
});
