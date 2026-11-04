// @vitest-environment jsdom
/**
 * /admin/story「宝箱・キラキラ」(D-CHEST-001 §7)。
 * - 「フラグ N/500、置きアイテム N/400」を出す
 * - 既存の id は入力欄にしない (改名すると全員の宝箱が閉じた状態に戻る)
 * - 壁・ゲート・NPC の上には置けない。存在しない報酬は保存できない
 * - 保存は戦闘と固定モンスターをそのまま書き戻す
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { captureNpcPlacementWorld, setInteriors, setNpcs, setWorldMap, WORLD_SIZE, type InteriorMap, type NpcDef, type StoryData } from '@aozoraquest/core';
import { SessionContext } from '@/lib/session';
import { loadStoryAuthoringRecords, saveStoryPlacedItems } from '@/lib/world-authoring';
import { AdminStory } from '../admin-story';

vi.mock('@/lib/world-authoring', async (orig) => ({
  ...(await orig<typeof import('@/lib/world-authoring')>()),
  loadStoryAuthoringRecords: vi.fn(),
  saveStoryPlacedItems: vi.fn(),
}));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });

const DID = 'did:plc:storyadmin';
const agent = { assertDid: DID } as unknown as Agent;
const W = 7;
const tiles = new Uint8Array(W * W);
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === W - 1) tiles[y * W + x] = 1;
const ROOM = { id: 'room', name: 'へや', size: W, tiles, parts: [{ terrain: 'floor-stone', name: '床', walkable: true }, { terrain: 'wall-brick', name: '壁', walkable: false }] } as InteriorMap;
const NPC: NpcDef = { id: 'n', name: 'むらびと', mapId: 'room', x: 2, y: 3, lines: ['やあ'] };
const STORY: StoryData = {
  placedItems: [{ id: 'old-spot', mapId: 'room', x: 4, y: 4, itemId: 'herb', count: 1, flag: 'got-old' }],
  battles: [{ id: 'b1', monsterId: 'sky-slime', count: 1, winFlag: 'beat' }],
  fieldMonsters: [],
};
const mount = () => render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}><AdminStory /></SessionContext.Provider></MemoryRouter>);

beforeEach(() => {
  vi.stubEnv('VITE_ADMIN_DIDS', DID);
  setWorldMap({ tiles: new Uint8Array(WORLD_SIZE * WORLD_SIZE), size: WORLD_SIZE });
  setInteriors([ROOM], []);
  setNpcs([NPC]);
  vi.mocked(loadStoryAuthoringRecords).mockImplementation(async () => ({
    npcs: [NPC], world: captureNpcPlacementWorld([NPC], false), story: structuredClone(STORY),
    events: [{ id: 'e', title: 't', when: [], setFlags: ['ch1'] }],
  }));
  vi.mocked(saveStoryPlacedItems).mockImplementation(async (_a, saved, placedItems) => ({ ...saved, placedItems }));
});
afterEach(() => { vi.unstubAllEnvs(); setNpcs(null); setInteriors(null, null); setWorldMap(null); vi.mocked(saveStoryPlacedItems).mockClear(); });

describe('AdminStory', () => {
  it('フラグ数と置きアイテム数を出し、既存の id は入力欄にしない', async () => {
    mount();
    expect(await screen.findByText('フラグ 3/500、置きアイテム 1/400')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /old-spot/ }));
    expect(screen.queryByLabelText('id')).toBeNull();
    expect(screen.getByText('old-spot', { selector: 'code' })).toBeTruthy();
  });

  it('宝箱を足して地図で置き、報酬を入れて保存すると、戦闘はそのまま書き戻す', async () => {
    mount();
    await screen.findByText(/フラグ 3\/500/);
    fireEvent.change(screen.getByLabelText('マップ'), { target: { value: 'room' } });
    fireEvent.change(screen.getByLabelText('新しい id'), { target: { value: 'room-chest-1' } });
    fireEvent.click(screen.getByRole('button', { name: '＋宝箱' }));
    fireEvent.change(screen.getByLabelText('座標 x'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('座標 y'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'この座標に置く' }));
    fireEvent.change(screen.getByLabelText('報酬 1 の種類'), { target: { value: 'power' } });
    fireEvent.change(screen.getByLabelText('報酬 1 の量'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveStoryPlacedItems).toHaveBeenCalledOnce());
    const [, saved, placed] = vi.mocked(saveStoryPlacedItems).mock.calls[0]!;
    expect(saved.battles).toEqual(STORY.battles);
    expect(placed.at(-1)).toEqual({ id: 'room-chest-1', mapId: 'room', x: 2, y: 2, kind: 'chest', rewards: [{ power: 3 }] });
  });

  it('壁・NPC の上には置けず、存在しない報酬は保存しない', async () => {
    mount();
    await screen.findByText(/フラグ 3\/500/);
    fireEvent.change(screen.getByLabelText('マップ'), { target: { value: 'room' } });
    fireEvent.change(screen.getByLabelText('新しい id'), { target: { value: 'c2' } });
    fireEvent.click(screen.getByRole('button', { name: '＋宝箱' }));
    for (const [x, y, why] of [['0', '0', /歩けない/], ['2', '3', /むらびと/]] as const) {
      fireEvent.change(screen.getByLabelText('座標 x'), { target: { value: x } });
      fireEvent.change(screen.getByLabelText('座標 y'), { target: { value: y } });
      fireEvent.click(screen.getByRole('button', { name: 'この座標に置く' }));
      expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(why);
    }
    fireEvent.change(screen.getByLabelText('座標 x'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('座標 y'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'この座標に置く' }));
    fireEvent.change(screen.getByLabelText('報酬 1 の種類'), { target: { value: 'item' } });
    fireEvent.change(screen.getByLabelText('報酬 1 の id'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/保存できない: .*存在しない/)).toBeTruthy();
    expect(saveStoryPlacedItems).not.toHaveBeenCalled();
  });
});
