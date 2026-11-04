// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setStory, type NpcDef } from '@aozoraquest/core';
import { GuildPartyModal, PARTY_LINES } from './guild-party-modal';

const GUILD: NpcDef = { id: 'g', name: 'うけつけ', x: 1, y: 1, lines: ['やあ'], guildReception: true };
const R = (id: string, name: string, archetype: 'warrior' | 'miko' | 'mage') => ({ id, name, archetype, guild: 'g', line: `${name}です。` });

async function open(party: string[], flags: string[], save = vi.fn(async (ids: string[]) => ({ ids }))) {
  setStory({ recruits: [R('a', 'カイト', 'warrior'), R('b', 'ミオ', 'miko'), R('c', 'ソラ', 'mage')] });
  render(<GuildPartyModal guild={GUILD} jobLevel={6} load={async () => ({ party: { ids: party }, flags })} save={save} onClose={vi.fn()} />);
  await act(async () => {});
  return save;
}
const flags2 = ['futaba_letter_done'];
const flags3 = [...flags2, 'yuuhi_feather_done'];
afterEach(() => { cleanup(); setStory(null); });

describe('GuildPartyModal', () => {
  it('今のパーティ (名前・職・Lv・HP/MP) と、このギルドで紹介できる冒険者 (名前・職・ひとこと) を並べる', async () => {
    await open(['a'], flags3);
    const mine = screen.getByRole('region', { name: 'いまの パーティ' });
    expect(mine.textContent).toContain('カイト');
    expect(mine.textContent).toContain('Lv6');
    expect(mine.textContent).toMatch(/HP \d+\/\d+/);
    const offered = screen.getByRole('region', { name: PARTY_LINES.heading });
    expect(offered.textContent).toContain('ミオ');
    expect(offered.textContent).toContain('ミオです。');
    expect(offered.textContent).not.toContain('カイト');
  });

  it('くわえる / はずす で ids を送り、文を出す', async () => {
    const save = await open(['a'], flags3);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ミオを くわえる' })); });
    expect(save).toHaveBeenLastCalledWith(['a', 'b']);
    expect(screen.getByText(PARTY_LINES.joined('ミオ'))).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'カイトを はずす' })); });
    expect(save).toHaveBeenLastCalledWith(['b']);
    expect(screen.getByText(PARTY_LINES.left('カイト'))).toBeTruthy();
  });

  it('いっぱいのときは、だれと入れかえるかを選ぶ', async () => {
    const save = await open(['a'], flags2);
    fireEvent.click(screen.getByRole('button', { name: 'ミオを くわえる' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(PARTY_LINES.full)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'カイトと いれかえる' })); });
    expect(save).toHaveBeenLastCalledWith(['b']);
  });

  it('ジョブ Lv が足りない冒険者も並べるが、「Lv N から」と出して くわえる は押せない', async () => {
    setStory({ recruits: [{ ...R('a', 'カイト', 'warrior'), minLevel: 10 }, R('b', 'ミオ', 'miko')] });
    render(<GuildPartyModal guild={GUILD} jobLevel={6} load={async () => ({ party: { ids: [] }, flags: flags3 })} save={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    const offered = screen.getByRole('region', { name: PARTY_LINES.heading });
    expect(offered.textContent).toContain('Lv 10 から');
    expect((screen.getByRole('button', { name: 'カイトを くわえる' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'ミオを くわえる' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('今のデータに無い id は 数えず、送る ids からも落とす', async () => {
    const save = await open(['gone', 'a'], flags3);
    expect(screen.getByRole('region', { name: 'いまの パーティ' }).textContent).toContain('（1/2）');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'ミオを くわえる' })); });
    expect(save).toHaveBeenLastCalledWith(['a', 'b']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'カイトを はずす' })); });
    expect(save).toHaveBeenLastCalledWith(['b']);
  });

  it('紹介できる冒険者がいなければ そう言う', async () => {
    setStory({ recruits: [] });
    render(<GuildPartyModal guild={GUILD} jobLevel={6} load={async () => ({ party: { ids: [] }, flags: flags2 })} save={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText(PARTY_LINES.none)).toBeTruthy();
  });
});
