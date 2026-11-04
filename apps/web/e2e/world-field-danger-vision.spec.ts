import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { favoredMonsterFor, regionAffinity, regionOf, setInteriors, setMonsterOverrides, setNpcs, setGameQuests, setScenario, terrainAt, tierForRegion, worldOverlay } from '@aozoraquest/core';
import { fieldLocationLabel } from '../src/lib/world-view';

// フィールドの危険度・よく出る敵は 賢者・予言者・忍者・遊び人 にだけ見える (docs/25 §ジョブ特性)。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'),
      'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:tutorialadmin'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: 4186, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 } });

for (const archetype of ['warrior', 'sage'] as const) test(`フィールドの上枠: ${archetype}`, async ({ page }) => {
  test.setTimeout(45_000);
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  setInteriors([], []); setNpcs([]); setGameQuests([]); setScenario([]); setMonsterOverrides(TEST_MONSTERS);
  const state: GameState = { did: 'did:plc:tutorial', power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const diag = { archetype, rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const records: Record<string, unknown> = {
    'app.aozoraquest.dev.world.monsters': { monsters: TEST_MONSTERS }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      const value = op === 'get' ? records[params.collection] : undefined;
      if (op === 'get') await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } });
      else await route.fulfill({ json: op === 'put' ? { uri: 'at://fixture/record' } : { records: [] } });
      return;
    }
    if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    await route.continue();
  });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.goto('http://127.0.0.1:4186/e2e/fixtures/world-shell.html');
  await expect(page.getByLabel('ワールドマップ', { exact: true })).toBeVisible();
  const region = regionOf(start.x, start.y), tier = tierForRegion(region);
  const monster = favoredMonsterFor(tier, regionAffinity(region))?.name;
  expect(monster).toBeTruthy();
  const forest = terrainAt(start.x, start.y) === 'forest';
  const label = fieldLocationLabel(tier, forest, monster, archetype === 'sage');
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  if (archetype === 'warrior') await expect(page.getByText(monster!)).toHaveCount(0);
  else expect(label).toContain(monster!);
  await page.screenshot({ path: `test-results/field-danger-vision-${archetype}-390.png` });
});
