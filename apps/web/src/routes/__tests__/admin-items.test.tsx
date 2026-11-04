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
    // herb に「戦闘」を入れると、効果の行が増える
    fireEvent.click(screen.getByLabelText('herb を戦闘でつかう'));
    expect(screen.getAllByLabelText('確率')).toHaveLength(2);
  });
});
