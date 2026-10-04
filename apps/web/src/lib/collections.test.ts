import { describe, expect, test, afterEach, vi } from 'vitest';

/**
 * 管理データの保存先の env 分離 (#716)。staging (VITE_NSID_ENV が空でない) は
 * `{ROOT}.dev.*`、本番 (未設定) は従来どおり `{ROOT}.*`。ローカル (local) も dev エッジを
 * 叩くので、エッジと同じ `{ROOT}.dev.*` を読む (web と edge の世界がずれると歩けなくなる)。
 * モジュールトップレベルで import.meta.env を評価するので stubEnv + 動的 import。
 */
describe('ADMIN_COL: 管理データの保存先を env で分離する (#716)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  async function load(env: string) {
    vi.stubEnv('VITE_NSID_ROOT', 'app.aozoraquest');
    vi.stubEnv('VITE_NSID_ENV', env);
    return import('./collections');
  }

  test('dev は全管理レコードを app.aozoraquest.dev.* に読み書きする', async () => {
    const { ADMIN_COL } = await load('dev');
    expect(ADMIN_COL.npcs).toBe('app.aozoraquest.dev.world.npcs');
    expect(ADMIN_COL.worldMap).toBe('app.aozoraquest.dev.world.map');
    expect(ADMIN_COL.configFlags).toBe('app.aozoraquest.dev.config.flags');
    for (const [key, col] of Object.entries(ADMIN_COL)) {
      if (key === 'directory' || key === 'questIndex') continue;
      expect(col.startsWith('app.aozoraquest.dev.')).toBe(true);
    }
  });

  test('ローカル (local) とテスト (test) も dev エッジと同じ app.aozoraquest.dev.* を使う', async () => {
    expect((await load('local')).ADMIN_COL.scenario).toBe('app.aozoraquest.dev.world.scenario');
    vi.resetModules();
    expect((await load('test')).ADMIN_COL.tileArt).toBe('app.aozoraquest.dev.world.tileArt');
  });

  test('本番 (未設定) は従来どおり app.aozoraquest.* (変更しない)', async () => {
    const { ADMIN_COL } = await load('');
    expect(ADMIN_COL.npcs).toBe('app.aozoraquest.world.npcs');
    expect(ADMIN_COL.configBans).toBe('app.aozoraquest.config.bans');
    expect(ADMIN_COL.interiors).toBe('app.aozoraquest.world.interiors');
  });

  test('directory と questIndex は env で分けない (毎時の自動更新 / rkey で分離済み)', async () => {
    const { ADMIN_COL } = await load('dev');
    expect(ADMIN_COL.directory).toBe('app.aozoraquest.directory');
    expect(ADMIN_COL.questIndex).toBe('app.aozoraquest.questIndex');
  });
});
