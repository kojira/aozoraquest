// @vitest-environment jsdom
/** モンスター 0 体 (world.monsters 未読込) のとき、模擬戦は理由を出して押せない (D-MONSTER-001)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import { clearMonsters, setMonsterOverrides } from '@aozoraquest/core';
import { TEST_MONSTERS } from '@aozoraquest/core/src/__tests__/helpers/monster-fixture';
import { SessionContext } from '@/lib/session';
import { DebugBattleSim } from '@/components/debug-battle-sim';
import { AdminJobs } from './admin-jobs';

vi.mock('@/lib/world-authoring', async (original) => ({
  ...await original<typeof import('@/lib/world-authoring')>(),
  loadJobsRecord: vi.fn().mockResolvedValue(undefined),
}));
const DID = 'did:plc:testadmin';
const agent = { assertDid: DID } as unknown as Agent;
const mount = (element: React.ReactNode) =>
  render(<MemoryRouter><SessionContext.Provider value={{ status: 'signed-in', did: DID, agent }}>{element}</SessionContext.Provider></MemoryRouter>);

beforeEach(() => { vi.stubEnv('VITE_ADMIN_DIDS', DID); clearMonsters(); });
afterEach(() => { vi.unstubAllEnvs(); setMonsterOverrides(TEST_MONSTERS); });

describe('モンスター 0 体のガード', () => {
  it('debug-battle-sim: 落ちずに「モンスター未読込」を出し、実行ボタンを出さない', () => {
    mount(<DebugBattleSim />);
    expect(screen.getByRole('status').textContent).toContain('モンスター未読込');
    expect(screen.queryByRole('button', { name: 'バッチ' })).toBeNull();
    expect(screen.queryByRole('button', { name: '1戦プレイ' })).toBeNull();
  });

  it('admin-jobs: 連戦シミュレーションのボタンを押せず、理由を出す', () => {
    mount(<AdminJobs />);
    expect((screen.getByRole('button', { name: '編集値で試す' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('モンスター未読込');
  });

  it('モンスターがいれば どちらも今までどおり使える', () => {
    setMonsterOverrides(TEST_MONSTERS);
    mount(<><DebugBattleSim /><AdminJobs /></>);
    expect(screen.getByRole('button', { name: 'バッチ' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '編集値で試す' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
