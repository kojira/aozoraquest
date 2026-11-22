import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { worldOverlay, setInteriors, setNpcs, setGameQuests, setScenario } from '@aozoraquest/core';

// #998: 遭遇の封印に失敗したときの画面の一言。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:tutorialadmin'), 'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: 4191, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });


// #998: サーバーが遭遇を封印できなかった (encounterFailed) ときは、黙らずに画面の一言で知らせる。
test('遭遇の封印に失敗したら「モンスターの気配がしたが、戦いを始められなかった。」を出し、歩き続けられる', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(5_000);
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  setInteriors([], []); setNpcs([]); setGameQuests([]); setScenario([]);
  const state = { did: 'did:plc:tutorial', power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: 1, version: 1, updatedAt: '' };
  const records: Record<string, unknown> = {
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('battle start failed')) errors.push(m.text()); });
  let moves = 0;
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
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    if (url.pathname.endsWith('/move')) {
      moves++;
      await route.fulfill({ json: { x: start.x, y: start.y - moves, terrain: 'grass', token: `t${moves}`, ...(moves === 1 ? { encounterFailed: true } : {}) } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'unexpected' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.goto('http://127.0.0.1:4191/e2e/fixtures/world-shell.html');
  await expect(page.getByLabel('ワールドマップ', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText('モンスターの気配がしたが、戦いを始められなかった。')).toBeVisible();
  expect(errors).toHaveLength(1);
  await expect(page.locator('.dq-message')).toHaveCount(0); // 戦闘は始まっていない
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => moves).toBe(2); // 歩き続けられる
});
