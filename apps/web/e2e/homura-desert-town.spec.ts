import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BASE_PARTS, bundledWorldMapTiles, encodeWorldMap, tileArtFor, WORLD_SIZE } from '@aozoraquest/core';

// #690: 実際の /admin/map でほむらの街の砂漠を下書きへ入れ、明示保存したレコードを World が表示する。
// 通信は隔離した fixture のみ (実 PDS には書かない)。
let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4283/e2e/fixtures/new-biomes.html';
const FIELD = 'app.aozoraquest.dev.world.map';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:shoreadmin'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/shore-fixture-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:shore.invalid') },
    server: { host: '127.0.0.1', port: 4283, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('ほむらの街の砂漠を入れて保存すると、World で町名と砂漠が見える', async ({ page }) => {
  test.setTimeout(120_000); page.setDefaultTimeout(10_000);
  await page.setViewportSize({ width: 1000, height: 1100 });
  await page.addInitScript(() => {
    for (const key of ['aq-world-onboarding-done', 'aq-world-menu-hint-done', 'aq-world-stick-hint-done']) localStorage.setItem(key, '1');
  });
  const tiles = await bundledWorldMapTiles();
  const parts = [...BASE_PARTS];
  const diag = { archetype: 'warrior', rpgStats: { atk: 30, def: 15, agi: 15, int: 15, luk: 15 } };
  const state = { did: 'did:plc:shoreadmin', x: 320, y: 448, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], version: 1, updatedAt: '' };
  const records: Record<string, any> = {
    [FIELD]: { size: WORLD_SIZE, parts, gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64') },
    'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: state.x, y: state.y, regions: [26], visitedTowns: [], gotStarterFeather: true, hp: null, mp: null },
  };
  const puts: string[] = [], errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/shore-fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') { const value = records[params.collection]; await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } }); }
      else if (op === 'put') { puts.push(params.collection); records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://isolated/record', cid: 'saved' } }); }
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (url.pathname.endsWith('/api/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    if (url.pathname.startsWith('/shore-fixture-api/')) { await route.fulfill({ json: { state } }); return; }
    await route.continue();
  });

  await page.goto(`${URL}?screen=field`);
  await page.getByRole('button', { name: 'ほむらの街の砂漠を入れる' }).click();
  await expect(page.getByText(/ほむらの街のまわり \d+ マスを砂漠にしました/)).toBeVisible();
  expect(puts).toEqual([]); // 挿入だけでは送信しない
  await page.getByLabel('フィールドマップを編集').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/homura-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'ほむらの街の砂漠を入れる' }).click();
  await expect(page.getByText('ほむらの街の砂漠は既に入っています')).toBeVisible();

  await page.getByRole('button', { name: '保存', exact: true }).first().click();
  await expect(page.getByText(/保存した/)).toBeVisible();
  expect(puts).toEqual([FIELD]);
  const saved = records[FIELD];
  expect(saved.parts.map((p: { terrain: string }) => p.terrain)).toEqual([...BASE_PARTS.map((p) => p.terrain), 'desert']);
  const out = new Uint8Array(gunzipSync(Buffer.from(saved.gz, 'base64')));
  expect(out[448 * WORLD_SIZE + 321]).toBe(BASE_PARTS.length);
  expect(out[448 * WORLD_SIZE + 320]).toBe(tiles[448 * WORLD_SIZE + 320]);

  await page.goto(`${URL}?screen=world`);
  const world = page.getByLabel('ワールドマップ', { exact: true });
  await expect(world).toBeVisible();
  await expect.poll(async () => world.locator('defs').first().innerHTML()).toContain(tileArtFor('desert')!.palette[1]!);
  await expect(page.getByText('🏘 ほむらの街')).toBeVisible();
  await page.screenshot({ path: 'test-results/homura-world.png' });
  expect(errors).toEqual([]);
});
