// @vitest-environment jsdom
/**
 * きずな の表示 (D-PARTY-004 A2)。
 * - なかま一覧の名前の右に ♥♥♡
 * - つよさの窓に「きずな 72／150（つぎの ♥ まで 78）」。ギルドの候補には出さない
 * - ♥ が増えたときだけ「〇〇との きずなが ふかまった！（♥♥♡）」を 1 行 (戦闘・クエスト報告・フィールドの回復)
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { xpForAllyLevel, type PartyRecruit } from '@aozoraquest/core';
import { PartyModal } from './party-modal';
import { fieldSkillMessage } from './field-skill-modal';
import { battleResultLines } from '@/lib/world-battle-result';
import { bondDetailText, heartsText } from '@/lib/bond-view';
import type { ServerParty } from '@/lib/world-server';

const MIO: PartyRecruit = { id: 'g:m', name: 'ミオ', archetype: 'miko', star: 2, minLevel: 5, line: 'ミオです。', xp: xpForAllyLevel('miko', 5) };
const KAI: PartyRecruit = { ...MIO, id: 'g:k', name: 'カイ', archetype: 'warrior' };

afterEach(cleanup);

describe('きずな の表示 (D-PARTY-004)', () => {
  it('なかま一覧の名前の右に ♥。詳細に きずな と つぎの ♥ まで', async () => {
    const party: ServerParty = { ids: [MIO.id, KAI.id], members: [MIO, KAI], bond: { [MIO.id]: 72 } };
    render(<PartyModal jobLevel={3} load={async () => ({ party, flags: [] })} onClose={() => {}} />);
    await act(async () => {});
    expect(screen.getByLabelText('きずな ♥2').textContent).toBe('♥♥♡');
    expect(screen.getByLabelText('きずな ♥0').textContent).toBe('♡♡♡');
    fireEvent.click(screen.getByRole('button', { name: 'ミオの つよさ' }));
    expect(screen.getByRole('dialog', { name: 'ミオの つよさ' }).textContent).toContain('きずな 72／150（つぎの ♥ まで 78）');
  });

  it('段階と上限の文', () => {
    expect([0, 19, 20, 60, 150].map(heartsText)).toEqual(['♡♡♡', '♡♡♡', '♥♡♡', '♥♥♡', '♥♥♥']);
    expect(bondDetailText(150)).toBe('きずな 150／150');
    expect(bondDetailText(undefined)).toBe('きずな 0／150（つぎの ♥ まで 20）');
  });

  it('♥ が増えたときだけ 1 行 (戦闘の結果・フィールドのとくぎ)', () => {
    expect(battleResultLines({ xp: 3 }, 'win', null)).toEqual(['けいけんちを3獲得！']);
    expect(battleResultLines({ xp: 3, allyBondUp: [{ id: 'g:m', name: 'ミオ', hearts: 2 }] }, 'win', null))
      .toEqual(['けいけんちを3獲得！', 'ミオとの きずなが ふかまった！（♥♥♡）']);
    expect(battleResultLines({ allyBondUp: [{ id: 'g:m', name: 'ミオ', hearts: 1 }] }, 'fled', null)).toEqual(['ミオとの きずなが ふかまった！（♥♡♡）']);
    expect(fieldSkillMessage({ casterName: 'ゆうしゃ', skillName: '癒しの鈴', healed: [{ id: 'g:m', name: 'ミオ', amount: 9 }], allyBondUp: [{ id: 'g:m', name: 'ミオ', hearts: 3 }] }))
      .toBe('ゆうしゃは 癒しの鈴を となえた！ ミオの HPが 9 かいふくした。 ミオとの きずなが ふかまった！（♥♥♥）');
  });
});
