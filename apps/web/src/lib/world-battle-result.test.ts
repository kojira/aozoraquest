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
      'けいけんち を 5 かくとく！',
      `${herb} ×2 を てにいれた！`,
      `${herb} を おとしてしまった…`,
      'たおれてしまった… 気がつくと「はじまりの村」で 手当てされていた。',
      'レベルが 2 に あがった！',
      'こうげき+2',
      'ひのこ を おぼえた！',
      'きずが すっかり いえた！',
    ]);
  });

  it('is empty for a plain flee so the battle closes straight to the map', () => {
    expect(battleResultLines({}, 'fled', null)).toEqual([]);
  });
});
