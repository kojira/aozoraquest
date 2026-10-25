import { describe, expect, it } from 'vitest';
import { ITEMS } from '@aozoraquest/core';
import { battleResultLines } from './world-battle-result';

describe('battleResultLines', () => {
  it('orders xp → drops (grouped) → lost → lose → level-up last', () => {
    const herb = ITEMS['herb']!.name;
    const lines = battleResultLines(
      { xp: 5, drops: ['herb', 'herb'], materialsLost: ['herb'], leveledUp: { from: 1, to: 2, gains: [{ key: 'atk', label: 'こうげき', delta: 2 }], learned: ['ひのこ'] } },
      'lose',
      'はじまりの村',
    );
    expect(lines).toEqual([
      'けいけんちを5獲得！',
      `${herb} ×2を手に入れた！`,
      `${herb}を落としてしまった…`,
      '倒れてしまった…気がつくと「はじまりの村」で手当てされていた。',
      'レベルが2に上がった！',
      'こうげき+2',
      'ひのこを覚えた！',
      '傷がすっかり癒えた！',
    ]);
  });

  it('is empty for a plain flee so the battle closes straight to the map', () => {
    expect(battleResultLines({}, 'fled', null)).toEqual([]);
  });

  it('台本負け (scripted) は「目の前が暗くなった……。」だけ。街へ運ばれた文は出さない', () => {
    expect(battleResultLines({}, 'lose', 'ほむらの街', true)).toEqual(['目の前が暗くなった……。']);
  });
});
