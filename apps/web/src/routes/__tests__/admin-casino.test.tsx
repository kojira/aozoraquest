// @vitest-environment jsdom
/** カジノの表のエディタ (D-CASINO-001 PR4): RTP を見せ、85〜98% の外・形の壊れた表は保存できない。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { casinoTables, setCasinoTables } from '@aozoraquest/core';
import { SessionContext } from '@/lib/session';
import { AdminCasino } from '../admin-casino';

const saveCasino = vi.fn(async () => {});
vi.mock('@/lib/world-authoring', async (original) => ({ ...await original<typeof import('@/lib/world-authoring')>(), saveCasino: (...a: unknown[]) => saveCasino(...(a as [])) }));
vi.mock('@/lib/use-authored-world', () => ({ useAuthoredWorld: () => true }));
const DID = 'did:plc:testadmin';
const agent = { assertDid: DID } as unknown as Agent;
const mount = () => render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}><AdminCasino /></SessionContext.Provider></MemoryRouter>);

beforeEach(() => { vi.stubEnv('VITE_ADMIN_DIDS', DID); saveCasino.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); setCasinoTables(null); });

describe('AdminCasino', () => {
  it('表の RTP と luk 0/30/60 を出す', () => {
    mount();
    expect(screen.getByTestId('rtp-race').textContent).toContain('94.00%');
    expect(screen.getByTestId('rtp-race').textContent).toContain('97.00%');
  });

  it('レースの倍率を上げて 98% を超えると 保存できない。戻せば保存できる', async () => {
    mount();
    fireEvent.change(screen.getByLabelText('1ばんの倍率'), { target: { value: '260' } });
    expect(screen.getByRole('alert').textContent).toContain('レース の RTP');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('1ばんの倍率'), { target: { value: '240' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
    expect(saveCasino).toHaveBeenCalledTimes(1);
  });

  it('コマ数の合計が 32 でないと保存できない', () => {
    mount();
    fireEvent.change(screen.getByLabelText('空きのコマ数'), { target: { value: '12' } });
    expect(screen.getByRole('alert').textContent).toContain('32');
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    expect(casinoTables().slots.symbols.find((s) => s.id === 'blank')!.count).toBe(11);
  });
});
