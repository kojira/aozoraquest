// @vitest-environment jsdom
/**
 * world.tsx から開くギルドの「なかまを さがす」(PartyModals)。
 * 読み込み (partyLoad) は world の state (party) を更新して親を描き直す。描き直しで読み込みが捨てられ、
 * 題と「とじる」だけの空の窓になった不具合の再発を防ぐ。
 */
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { NpcDef, RecruitCandidate } from '@aozoraquest/core';
import { PartyModals } from './party-modal';
import { PARTY_LINES } from './guild-party-modal';
import type { ServerParty, ServerPartyCandidates } from '@/lib/world-server';

const GUILD: NpcDef = { id: 'futaba-guild', name: 'うけつけ', x: 1, y: 1, lines: ['やあ'], guildReception: true };
const KAITO: RecruitCandidate = { id: 'g:2026-11-05:futaba-guild:0:0', name: 'カイト', archetype: 'warrior', star: 1, level: 5, minLevel: 5, line: 'カイトです。' };
const OFFER: ServerPartyCandidates = { day: '2026-11-05', candidates: [KAITO], power: 92, rerollPower: 5 };

/** use-npc-quest-talk と同じく、load が親の state を更新し、candidates は useCallback で安定。 */
function World({ candidates }: { candidates: (guild: string) => Promise<ServerPartyCandidates> }) {
  const [, setParty] = useState<ServerParty>({ ids: [] });
  const load = useCallback(async () => {
    const party = { ids: [] };
    setParty(party);
    return { party, flags: ['futaba_letter_done'] };
  }, []);
  return <PartyModals guildNpc={GUILD} menuOpen={false} jobLevel={6} load={load} save={vi.fn()} candidates={candidates} reroll={vi.fn()} onGuildClose={vi.fn()} onMenuClose={vi.fn()} />;
}

afterEach(cleanup);

describe('PartyModals (ギルドの なかまを さがす)', () => {
  it('読み込みで親が描き直されても、今日の候補が出る (読み込みは 1 回)', async () => {
    const candidates = vi.fn(async () => OFFER);
    render(<World candidates={candidates} />);
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(screen.getByRole('region', { name: PARTY_LINES.heading }).textContent).toContain('カイト');
    expect(candidates).toHaveBeenCalledTimes(1);
    expect(candidates).toHaveBeenCalledWith('futaba-guild');
  });

  it('読み込みの間は「読み込み中…」と出す (空の窓にしない)', async () => {
    render(<World candidates={() => new Promise<ServerPartyCandidates>(() => {})} />);
    await act(async () => {});
    expect(screen.getByText('読み込み中…')).toBeTruthy();
  });
});
