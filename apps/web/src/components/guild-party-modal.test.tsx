// @vitest-environment jsdom
/**
 * ギルドの「なかまを さがす」(D-PARTY-001 / D-PARTY-002)。
 * - 今日の候補 (edge) を ★・Lv・ひとことつきで並べ、一期一会のお知らせを出す
 * - Lv が足りない人は「Lv N から」と「パワー◯で くわえる」(§14)。パワーが足りなければ押せない。払ったら残りのパワーを出す
 * - はずす・いれかえるときは確かめが出て、「やめる」なら送らない
 * - 引き直し (パワー 5) で新しい候補になる。パワーが足りなければ押せない
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setStory, xpForAllyLevel, type NpcDef, type PartyRecruit, type RecruitCandidate } from '@aozoraquest/core';
import { GuildPartyModal, PARTY_LINES } from './guild-party-modal';
import type { ServerParty, ServerPartyCandidates } from '@/lib/world-server';

const GUILD: NpcDef = { id: 'g', name: 'うけつけ', x: 1, y: 1, lines: ['やあ'], guildReception: true };
const C = (slot: number, name: string, archetype: RecruitCandidate['archetype'], over: Partial<RecruitCandidate> = {}): RecruitCandidate => ({ id: `g:2026-11-05:g:0:${slot}`, name, archetype, star: 1, level: 5, minLevel: 5, line: `${name}です。`, ...over });
const member = (c: RecruitCandidate): PartyRecruit => ({ id: c.id, name: c.name, archetype: c.archetype, star: c.star, minLevel: c.minLevel, line: c.line, xp: xpForAllyLevel(c.archetype, c.level) });
const flags2 = ['futaba_letter_done'];
const flags3 = [...flags2, 'yuuhi_feather_done'];
const TODAY = [C(0, 'カイト', 'warrior', { star: 3, level: 7 }), C(1, 'ミオ', 'miko', { star: 2 }), C(2, 'ソラ', 'mage', { minLevel: 10 })];
const offer = (candidates: RecruitCandidate[], power = 12): ServerPartyCandidates => ({ day: '2026-11-05', candidates, power, rerollPower: 5 });

async function open(party: ServerParty, flags: string[], o: {
  save?: ReturnType<typeof vi.fn>; candidates?: ServerPartyCandidates; reroll?: ReturnType<typeof vi.fn>;
} = {}) {
  const cands = o.candidates ?? offer(TODAY);
  const save = o.save ?? vi.fn(async (ids: string[]) => ({ party: { ids, members: [...(party.members ?? []), ...TODAY.filter((c) => ids.includes(c.id)).map(member)].filter((m) => ids.includes(m.id)) }, power: cands.power }));
  const reroll = o.reroll ?? vi.fn(async () => offer([C(0, 'ハル', 'guardian')], 7));
  render(<GuildPartyModal guild={GUILD} jobLevel={6} load={async () => ({ party, flags })} save={save} candidates={async () => cands} reroll={reroll} onClose={vi.fn()} />);
  await act(async () => {});
  return { save, reroll };
}
afterEach(() => { cleanup(); setStory(null); });
const region = (name: string) => screen.getByRole('region', { name });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('GuildPartyModal (D-PARTY-002)', () => {
  it('今日の候補を ★・Lv・ひとこと つきで並べ、一期一会のお知らせを出す', async () => {
    await open({ ids: [] }, flags3);
    const offered = region(PARTY_LINES.heading);
    expect(offered.textContent).toContain(PARTY_LINES.onceOnly);
    expect(offered.querySelectorAll('[data-candidate]')).toHaveLength(3);
    expect(offered.textContent).toContain('カイト');
    expect(offered.textContent).toContain('Lv7');
    expect(screen.getByLabelText('★3').textContent).toBe('★★★');
    expect(offered.textContent).toContain('ミオです。');
  });

  it('Lv が足りない人は「Lv N から」と「パワー◯で くわえる」。パワーが足りなければ押せない', async () => {
    await open({ ids: [] }, flags3);
    expect(region(PARTY_LINES.heading).textContent).toContain('Lv 10 から');
    expect(PARTY_LINES.payJoin(20)).toBe('パワー20で くわえる');
    const pay = button('ソラを パワー20で くわえる');
    expect(pay.textContent).toBe('パワー20で くわえる');
    expect(pay.disabled).toBe(true);
    expect(button('ミオを くわえる').disabled).toBe(false);
  });

  it('パワーが足りれば 払って くわえる (rkey つきで送る)。残りのパワーを出しなおす', async () => {
    const save = vi.fn(async (ids: string[]) => ({ party: { ids, members: [member(TODAY[2]!)] }, power: 5 }));
    await open({ ids: [] }, flags3, { save, candidates: offer(TODAY, 25) });
    expect(screen.getByText('パワー 25')).toBeTruthy();
    const pay = button('ソラを パワー20で くわえる');
    expect(pay.disabled).toBe(false);
    await act(async () => { fireEvent.click(pay); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toEqual([TODAY[2]!.id]);
    expect(typeof (save.mock.calls[0] as unknown[])[1]).toBe('string');
    expect(screen.getByText('パワー 5')).toBeTruthy();
    await act(async () => { fireEvent.click(button('ミオを くわえる')); });
    expect(save.mock.calls[1]).toEqual([[TODAY[2]!.id, TODAY[1]!.id]]);
  });

  it('くわえると ids を送り、その人は一覧から消える。仲間の Lv は自分の経験値から', async () => {
    const { save } = await open({ ids: [] }, flags3);
    await act(async () => { fireEvent.click(button('カイトを くわえる')); });
    expect(save).toHaveBeenLastCalledWith([TODAY[0]!.id]);
    expect(screen.getByText(PARTY_LINES.joined('カイト'))).toBeTruthy();
    expect(region(PARTY_LINES.heading).textContent).not.toContain('カイト');
    expect(region('いまの パーティ').textContent).toContain('Lv7');
  });

  it('はずすときは確かめが出る。「やめる」なら送らず、「はずす」で送る', async () => {
    const m = member(TODAY[1]!);
    const { save } = await open({ ids: [m.id], members: [m] }, flags3);
    fireEvent.click(button('ミオを はずす'));
    expect(screen.getByRole('alertdialog').textContent).toContain(PARTY_LINES.partConfirm('ミオ'));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(button('ミオを はずす'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'はずす' })); });
    expect(save).toHaveBeenLastCalledWith([]);
  });

  it('いっぱいなら いれかえる相手を選び、確かめてから送る', async () => {
    const m = member(TODAY[1]!);
    const { save } = await open({ ids: [m.id], members: [m] }, flags2);
    fireEvent.click(button('カイトを くわえる'));
    expect(screen.getByText(PARTY_LINES.full)).toBeTruthy();
    fireEvent.click(button('ミオと いれかえる'));
    expect(save).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'はずす' })); });
    expect(save).toHaveBeenLastCalledWith([TODAY[0]!.id]);
  });

  it('引き直すと新しい候補になる。パワーが 5 に足りなければ押せない', async () => {
    const { reroll } = await open({ ids: [] }, flags3);
    const label = PARTY_LINES.reroll(5);
    expect(label).toBe('ほかの冒険者をさがす（パワー5）');
    await act(async () => { fireEvent.click(button(label)); });
    expect(reroll).toHaveBeenCalledTimes(1);
    expect(typeof reroll.mock.calls[0]![0]).toBe('string');
    expect(region(PARTY_LINES.heading).textContent).toContain('ハル');
    expect(region(PARTY_LINES.heading).textContent).not.toContain('カイト');
    expect(button(label).disabled).toBe(false);
    cleanup();
    await open({ ids: [] }, flags3, { candidates: offer(TODAY, 4) });
    expect(button(label).disabled).toBe(true);
  });

  it('今日の候補がもういなければ そう言う', async () => {
    await open({ ids: [] }, flags2, { candidates: offer([]) });
    expect(screen.getByText(PARTY_LINES.goneToday)).toBeTruthy();
  });

  it('今のデータに無い id は 数えず、送る ids からも落とす。なじみ (名前つき) も並ぶ', async () => {
    setStory({ recruits: [{ id: 'a', name: 'ゲン', archetype: 'ninja', guild: 'g', line: 'よろしく。' }] });
    const { save } = await open({ ids: ['gone', 'a'] }, flags3);
    expect(region('いまの パーティ').textContent).toContain('（1/2）');
    expect(region('いまの パーティ').textContent).toContain('ゲン');
    await act(async () => { fireEvent.click(button('ミオを くわえる')); });
    expect(save).toHaveBeenLastCalledWith(['a', TODAY[1]!.id]);
  });
});
