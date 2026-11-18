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
      if (key === 'questIndex') continue;
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

  test('directory も env で分ける (D-ENV-002: dev の管理画面の保存が本番の発見ディレクトリを書かない)', async () => {
    expect((await load('dev')).ADMIN_COL.directory).toBe('app.aozoraquest.dev.directory');
    vi.resetModules();
    expect((await load('local')).ADMIN_COL.directory).toBe('app.aozoraquest.dev.directory');
    vi.resetModules();
    expect((await load('')).ADMIN_COL.directory).toBe('app.aozoraquest.directory');
  });
});

/**
 * D-ENV-002: user 記録の名前空間。本番 = app.aozoraquest.*、dev と local = app.aozoraquest.dev.*
 * (local は dev エッジを叩き、エッジは env で .dev.analysis などを読む)、test / e2etest は隔離 sandbox。
 * どの env も他の env の記録を読まない (他人の analysis を読むときも同じ COL)。
 */
describe('COL: user 記録の名前空間を env で分ける (D-ENV-002)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  async function load(env: string) {
    vi.stubEnv('VITE_NSID_ROOT', 'app.aozoraquest');
    vi.stubEnv('VITE_NSID_ENV', env);
    return import('./collections');
  }
  const ROOT_ENTRIES = (m: Record<string, unknown>) => Object.keys(m).filter((k) => k === 'ROOT_COL');

  for (const [env, prefix] of [['', 'app.aozoraquest.'], ['dev', 'app.aozoraquest.dev.'], ['local', 'app.aozoraquest.dev.'], ['test', 'app.aozoraquest.test.'], ['e2etest', 'app.aozoraquest.e2etest.']] as const) {
    test(`VITE_NSID_ENV=${env || '(未設定)'} の user 記録はすべて ${prefix}*`, async () => {
      const m = await load(env);
      for (const col of Object.values(m.COL)) {
        expect(col.startsWith(prefix)).toBe(true);
        if (prefix === 'app.aozoraquest.') expect(col.split('.')).toHaveLength(3); // 本番は .dev. などを含まない
      }
      expect(ROOT_ENTRIES(m)).toEqual([]); // 本番の記録を読む別の名前は無い
    });
  }
});
