// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { starterTownNpcs, starterTownInterior, starterTownQuests, worldOverlay, setNpcs, setInteriors, setGameQuests, gameQuests, setScenario, scenarioEvents, SAMPLE_SCENARIO, type GameQuestDef } from '@aozoraquest/core';
import { SessionContext } from '@/lib/session';
import { AdminQuests } from './admin-quests';
import { AdminScenario } from './admin-scenario';
import { loadAuthoredWorld, loadQuestAuthoringRecords } from '@/lib/world-authoring';

vi.mock('@/lib/world-authoring', async (original) => ({
  ...await original<typeof import('@/lib/world-authoring')>(),
  loadAuthoredWorld: vi.fn().mockResolvedValue(undefined),
  loadQuestAuthoringRecords: vi.fn(),
}));
const DID = 'did:plc:testadmin';
const putRecord = vi.fn().mockResolvedValue({});
const agent = { assertDid: DID, com: { atproto: { repo: { putRecord, getRecord: async () => ({ data: { value: { events: SAMPLE_SCENARIO } } }) } } } } as unknown as Agent;
function mount(element: React.ReactNode) {
  return render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}>{element}</SessionContext.Provider></MemoryRouter>);
}
beforeEach(() => {
  vi.mocked(loadAuthoredWorld).mockResolvedValue(undefined);
  vi.stubEnv('VITE_ADMIN_DIDS', DID);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  putRecord.mockClear();
  setNpcs(starterTownNpcs());
  setInteriors([starterTownInterior(worldOverlay().towns[0]!)], []);
  setGameQuests([]); setScenario([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); });

describe('ふたばの村の同梱データを明示的に入れる', () => {
  it('依頼の挿入はdraftのみ。無関係IDを保持し、保存後だけglobal定義を更新する', async () => {
    const other: GameQuestDef = { ...starterTownQuests()[0]!, id: 'another', npcId: 'futaba-kid' };
    setGameQuests([other]);
    vi.mocked(loadQuestAuthoringRecords).mockResolvedValue([other]);
    mount(<AdminQuests />);
    const insert = await screen.findByRole('button', { name: 'ふたばの村のクエストを入れる' });
    await waitFor(() => expect(insert.closest('fieldset')?.disabled).not.toBe(true));
    fireEvent.click(insert);
    expect(putRecord).not.toHaveBeenCalled();
    expect(gameQuests().map((q) => q.id)).toEqual(['another']);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(putRecord).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(gameQuests()).toHaveLength(4));
    expect(gameQuests().some((q) => q.id === 'another')).toBe(true);
  });
  it('読込み失敗中にクリックしても導入データや空リストを保存しない', async () => {
    vi.mocked(loadQuestAuthoringRecords).mockRejectedValue(new Error('offline'));
    mount(<AdminQuests />);
    await screen.findByRole('alert');
    const save = screen.getByRole('button', { name: '保存' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    expect(putRecord).not.toHaveBeenCalled();
  });
  it('シナリオも保存までdraft。既存サンプルを残し3イベントを入れる', async () => {
    setGameQuests(starterTownQuests());
    vi.mocked(loadQuestAuthoringRecords).mockResolvedValue(starterTownQuests());
    mount(<AdminScenario />);
    const insert = screen.getByRole('button', { name: 'ふたばの村のシナリオを入れる' });
    await waitFor(() => expect((insert as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(insert);
    expect(scenarioEvents()).toEqual(SAMPLE_SCENARIO);
    expect(putRecord).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(scenarioEvents()).toHaveLength(6));
    expect(scenarioEvents().filter((e) => e.id.startsWith('sample-'))).toHaveLength(3);
  });
});
