// @vitest-environment jsdom
/**
 * そうびの「だれの？」(D-PARTY-004 B2)。
 * - 仲間がいれば上に 主人公＋仲間 の切りかえ。いなければ今と同じ (出さない)
 * - ほかの人が着ている品は「ミオが そうび中」と出して選べない・すてられない
 * - 仲間を選んで そうびする と、その仲間の {id, level} をサーバーへ送る
 * - 同じ品を 2 つ持っていれば、もう 1 つは選べる
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { xpForAllyLevel, type PartyRecruit } from '@aozoraquest/core';
import { PartyGearModal } from './party-gear-modal';
import type { CraftedPiece } from '@/lib/crafting';
import type { ServerParty } from '@/lib/world-server';

const MIO: PartyRecruit = { id: 'g:m', name: 'ミオ', archetype: 'warrior', star: 2, minLevel: 1, line: 'よろしく。', xp: xpForAllyLevel('warrior', 5) };
const piece = (rkey: string, itemId: string, level = 0): CraftedPiece => ({ rkey, itemId, level, at: '' });
const SWORD = 'wp-travel-sword';

function open({ pieces, refs = {}, party, saveAllyGear = vi.fn(async () => {}) }: { pieces: CraftedPiece[]; refs?: Record<string, string>; party: ServerParty; saveAllyGear?: (id: string, gear: unknown) => Promise<void> }) {
  render(<PartyGearModal archetype="warrior" heroName="ゆうしゃ" pieces={pieces} refs={refs} party={party} jobLevel={5} onEquip={vi.fn()} onUnequip={vi.fn()} onDiscard={vi.fn()} saveAllyGear={saveAllyGear} onClose={() => {}} />);
  return saveAllyGear;
}
/** その品の行 (名前のある行)。 */
const rowOf = (name: string) => screen.getAllByText(name)[0]!.closest('div')!;

afterEach(cleanup);

describe('そうびの「だれの？」(D-PARTY-004)', () => {
  it('仲間がいなければ「だれの？」は出ない', () => {
    open({ pieces: [], party: { ids: [] } });
    expect(screen.queryByRole('radiogroup', { name: 'だれの？' })).toBeNull();
  });

  it('仲間が着ている品は、主人公の画面で「ミオが そうび中」と出て そうびする・すてる が無い', () => {
    open({ pieces: [piece('p1', SWORD)], party: { ids: [MIO.id], members: [MIO], gear: { [MIO.id]: { weapon: { id: SWORD, level: 0 } } } } });
    expect(within(screen.getByRole('radiogroup', { name: 'だれの？' })).getAllByRole('radio').map((b) => b.textContent)).toEqual(['▸ ゆうしゃ', 'ミオ']);
    const row = rowOf('たびのつるぎ');
    expect(row.textContent).toContain('ミオが そうび中');
    expect(within(row).queryByRole('button', { name: 'そうびする' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'すてる' })).toBeNull();
  });

  it('ミオを選ぶと、主人公が着ている品は「ゆうしゃが そうび中」。もう 1 本は そうびでき、ミオの {id, level} を送る', async () => {
    const save = open({ pieces: [piece('p1', SWORD), piece('p2', SWORD)], refs: { weapon: 'p1' }, party: { ids: [MIO.id], members: [MIO] } });
    fireEvent.click(screen.getByRole('radio', { name: 'ミオ' }));
    expect(screen.getByText('ゆうしゃが そうび中')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'そうびする' })); });
    expect(save).toHaveBeenCalledWith(MIO.id, { weapon: { id: SWORD, level: 0 } });
  });

  it('仲間の送信が断られたら理由を出す', async () => {
    open({ pieces: [piece('p1', SWORD)], party: { ids: [MIO.id], members: [MIO] }, saveAllyGear: async () => { throw new Error('その品は ほかの人が そうびしている'); } });
    fireEvent.click(screen.getByRole('radio', { name: 'ミオ' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'そうびする' })); });
    expect(screen.getByRole('alert').textContent).toBe('その品は ほかの人が そうびしている');
  });
});
