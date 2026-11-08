// @vitest-environment jsdom
/** /admin/items の「どうぐ」(D-ITEM-001 §6 / #854): 開いて保存しても key・battle・値段が消えない。不正な効果は保存できない。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { activeEquipment, activeItems, setItemOverrides, type ItemDefData } from '@aozoraquest/core';
import { SessionContext } from '@/lib/session';
import { saveItems } from '@/lib/world-authoring';
import { AdminItems } from '../admin-items';

vi.mock('@/lib/world-authoring', async () => {
  const core = await import('@aozoraquest/core');
  return {
    loadAuthoredWorld: vi.fn().mockResolvedValue(undefined),
    // 本物と同じく core の検証を通してから保存する (壊れた品は ItemDataError で止まる)
    saveItems: vi.fn(async (_a: unknown, items: ItemDefData[], equipment: unknown[]) => { core.setItemOverrides({ items, equipment: equipment as never }); }),
  };
});
const DID = 'did:plc:itemadmin';
const agent = { assertDid: DID } as unknown as Agent;
const KEY: ItemDefData = { id: 'old-letter', name: 'ふるい手紙', key: true };
const NEMURI: ItemDefData = {
  id: 'nemuri-kona', name: 'ねむりごな', desc: '敵 1 体を眠らせる', price: { power: 3, materials: 1 }, shopTier: 1,
  battle: { effects: [{ kind: 'status', status: 'sleep', target: 'enemy', chance: 0.7, turns: 3 }] },
};
const mount = () => render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}><AdminItems /></SessionContext.Provider></MemoryRouter>);
const savedItems = () => vi.mocked(saveItems).mock.calls.at(-1)![1];

beforeEach(() => {
  vi.stubEnv('VITE_ADMIN_DIDS', DID);
  setItemOverrides({ items: [...activeItems(), KEY, NEMURI], equipment: [...activeEquipment()] });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); setItemOverrides(null); vi.mocked(saveItems).mockClear(); });

describe('AdminItems の どうぐ', () => {
  it('開いて 1 か所だけ変えて保存しても、key・battle・desc・値段・shopTier が残る', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'どうぐ・素材' }));
    fireEvent.change(screen.getByDisplayValue('ねむりごな'), { target: { value: 'ねむりのこな' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveItems).toHaveBeenCalled());
    const items = savedItems();
    expect(items.find((x) => x.id === 'old-letter')).toEqual(KEY);
    expect(items.find((x) => x.id === 'nemuri-kona')).toEqual({ ...NEMURI, name: 'ねむりのこな' });
  });

  it('「戦闘」を入れると効果の欄が開き、確率 1 を超える効果は保存できない', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'どうぐ・素材' }));
    fireEvent.change(screen.getByLabelText('確率'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/保存できない: .*chance/)).toBeTruthy();
    // sky-feather に「戦闘」を入れると、効果の行が増える
    fireEvent.click(screen.getByLabelText('sky-feather を戦闘でつかう'));
    expect(screen.getAllByLabelText('確率')).toHaveLength(2);
  });

  it('やくそう・そらのしずくには「戦闘でつかう」を出さない (専用のコマンドで使う)', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'どうぐ・素材' }));
    expect(screen.queryByLabelText('herb を戦闘でつかう')).toBeNull();
    expect(screen.queryByLabelText('sky-dew を戦闘でつかう')).toBeNull();
    expect(screen.getByLabelText('nemuri-kona を戦闘でつかう')).toBeTruthy();
  });

  it('戦闘で使わない消耗品にも値段・tier・説明が出て保存でき、「戦闘」を外しても値段の欄は残る', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'どうぐ・素材' }));
    // herb は battle を持たないが、値段の欄がある
    fireEvent.change(screen.getByLabelText('herb の値段 パワー'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('herb の店の tier'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('herb の説明'), { target: { value: 'HP を回復する' } });
    // nemuri-kona の「戦闘」を外しても、値段・tier の欄は残る (消えるのは battle だけ)
    fireEvent.click(screen.getByLabelText('nemuri-kona を戦闘でつかう'));
    expect(screen.queryAllByLabelText('確率')).toHaveLength(0);
    expect((screen.getByLabelText('nemuri-kona の値段 パワー') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('nemuri-kona の店の tier') as HTMLSelectElement).value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveItems).toHaveBeenCalled());
    const items = savedItems();
    expect(items.find((x) => x.id === 'herb')).toEqual({ id: 'herb', name: 'やくそう', desc: 'HP を回復する', price: { power: 2, materials: 0 }, shopTier: 1 });
    const { battle: _b, ...nemuriNoBattle } = NEMURI;
    expect(items.find((x) => x.id === 'nemuri-kona')).toEqual(nemuriNoBattle);
  });
});
