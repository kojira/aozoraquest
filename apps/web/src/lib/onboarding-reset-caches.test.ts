import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { jobLevelFromXp, playerCombatant, playerLevelFromXp, startBattle, statVectorToArray, type Archetype } from '@aozoraquest/core';

/** サーバー (edge) と PDS のフェイク。リセット前は Lv の高い状態、serverReset で初期状態に戻る。 */
const server = vi.hoisted(() => ({
  jobXp: {} as Record<string, number>,
  analysis: null as Record<string, unknown> | null,
}));

vi.mock('./world-server', () => ({
  worldServerEnabled: true,
  serverState: vi.fn(async () => ({ state: { jobXp: server.jobXp }, initialized: true })),
  serverReset: vi.fn(async () => { server.jobXp = { warrior: 60 }; }),
}));
vi.mock('./atproto', () => ({
  getRecord: vi.fn(async () => server.analysis),
  putRecord: vi.fn(async (_a: unknown, _c: string, _r: string, v: Record<string, unknown>) => { server.analysis = v; }),
}));
vi.mock('./points', () => ({ resetWorldPower: vi.fn(async () => {}) }));

import { resetOnboarding } from './onboarding-reset';
import { clearJobXpCache, loadJobXp, xpOfJob } from './use-job-xp';
import { clearSelfDiagnosisCache, loadSelfDiagnosis } from './use-self-diagnosis';

const DID = 'did:test:reset';
const ARCH: Archetype = 'warrior';
const RPG = { atk: 40, def: 15, agi: 15, int: 15, luk: 15 };
const agent = {
  com: { atproto: { repo: { listRecords: async () => ({ data: { records: [] } }), deleteRecord: async () => ({ data: {} }) } } },
} as unknown as Agent;

/** world.tsx の HUD と同じ導出 (キャッシュした jobXp / analysis → Lv と最大 HP/MP)。 */
async function hud() {
  const jobXp = xpOfJob(await loadJobXp(agent, DID), ARCH)!;
  const diag = await loadSelfDiagnosis(agent, DID);
  const lv = jobLevelFromXp(jobXp, ARCH);
  const c = playerCombatant(ARCH, lv, playerLevelFromXp(diag?.playerLevel?.xp ?? 0), '', diag?.rpgStats ? statVectorToArray(diag.rpgStats) : undefined);
  return { lv, hp: c.maxHp, mp: c.maxMp };
}

/** edge の sealEncounter と同じ導出 (サーバー state の jobXp → 戦闘の Lv と HP/MP)。 */
function battle() {
  const lv = jobLevelFromXp(server.jobXp[ARCH] ?? 0, ARCH);
  const p = startBattle(ARCH, lv, playerLevelFromXp(0), 'me', 1, 1, 0, {}, { baseStats: statVectorToArray(RPG) }).player;
  return { lv, hp: p.maxHp, mp: p.maxMp };
}

describe('resetOnboarding のキャッシュ破棄 (#696)', () => {
  beforeEach(() => {
    clearJobXpCache();
    clearSelfDiagnosisCache();
    server.jobXp = { warrior: 1_000_000 };
    server.analysis = { archetype: ARCH, rpgStats: RPG, playerLevel: { level: 20, xp: 50_000 }, jobLevel: { current: ARCH, xp: 50_000 } };
  });

  test('リセット後の HUD の Lv/HP/MP が戦闘の Lv/HP/MP と一致する', async () => {
    const before = await hud(); // 旧 Lv をキャッシュした状態 (ワールドを開いていた)
    expect(before).toEqual(battle());

    await resetOnboarding(agent, DID);

    const after = await hud();
    expect(after).toEqual(battle());
    expect(after.lv).toBeLessThan(before.lv);
  });
});
