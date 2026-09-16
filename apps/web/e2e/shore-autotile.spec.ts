import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BASE_PARTS, encodeTileArt, encodeWorldMap, WORLD_SIZE } from '@aozoraquest/core';

import { sandArt, snowArt } from './fixtures/shore-ground-art';

// Definition prefixes differ between screens; compare actual ground art, clipping and overlay.
const shoreMarkup = (els: Element[]) => els.map((el) => el.outerHTML.replace(/id="[^"]*-ground-(\d+)"/g, 'id="ground-$1"').replace(/url\(#[^)]*-ground-(\d+)\)/g, 'url(#ground-$1)')).sort();

let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4275/e2e/fixtures/shore-autotile.html';
const INTERIORS = 'app.aozoraquest.world.interiors';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:shoreadmin'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/shore-fixture-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:shore.invalid') },
    server: { host: '127.0.0.1', port: 4275, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('real interior paint → shore preview → explicit save → reload → World preserves shapes and data', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(8_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  const tiles = new Uint8Array(16 * 16);
  // Own parts deliberately use different indices from the field palette.
  const map = { id: 'shore-garden', name: '岸辺の庭', size: 16,
    parts: [{ terrain: 'plains', name: '草原', walkable: true }, { terrain: 'water', name: '海', walkable: false }, { terrain: 'pond', name: '池', walkable: false }],
    gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64') };
  const untouched = { id: 'untouched', name: '別の部屋', size: 4, gz: Buffer.from(await encodeWorldMap(new Uint8Array(16))).toString('base64') };
  const records: Record<string, any> = {
    [INTERIORS]: { interiors: [map, untouched], gates: [] },
    'app.aozoraquest.world.tileArt': { arts: { plains: encodeTileArt(sandArt) } },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 30, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: 7, y: 7, regions: [], visitedTowns: [], gotStarterFeather: true, hp: null, mp: null },
  };
  const puts: string[] = [], errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/shore-fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        const value = records[params.collection];
        await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'isolated' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') {
        puts.push(params.collection); records[params.collection] = params.record;
        await route.fulfill({ json: { uri: 'at://isolated/record', cid: 'saved' } });
      } else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (url.pathname === '/shore-fixture-api/api/me/state') {
      await route.fulfill({ json: { state: { did: 'did:plc:shoreadmin', power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [],
        mapId: map.id, x: 7, y: 7, version: 1, updatedAt: '' }, initialized: false } }); return;
    }
    if (url.pathname.startsWith('/shore-fixture-api/')) { await route.abort(); return; }
    await route.continue();
  });
  await page.goto(URL);
  await page.getByRole('button', { name: /岸辺の庭.*16²/ }).click();
  const editor = page.getByLabel('内部マップを編集');
  const paint = async (x: number, y: number) => {
    const b = (await editor.boundingBox())!;
    await page.mouse.click(b.x + (x + 0.5) * b.width / 16, b.y + (y + 0.5) * b.height / 16);
  };
  await page.getByTitle('海', { exact: true }).click();
  for (const [x, y] of [[5, 5], [6, 5], [5, 6], [6, 6], [7, 6], [8, 6]]) { await paint(x!, y!); tiles[y! * 16 + x!] = 1; }
  await page.getByTitle('池', { exact: true }).click();
  await paint(8, 8); tiles[8 * 16 + 8] = 2;
  const shapes = await editor.locator('[data-shore-mask]').evaluateAll(shoreMarkup);
  expect(shapes.length).toBeGreaterThan(2);
  expect(shapes.join('')).toContain(sandArt.palette[0]);
  expect(shapes.join('')).not.toContain('#3f9d3f');
  await expect(editor.locator('[data-shore-mask="0"]')).toHaveCount(1);
  expect(puts).toEqual([]); // painting is still only a draft
  await page.screenshot({ path: 'test-results/shore-editor-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/2 マップ.*を保存した/)).toBeVisible();
  expect(puts).toEqual([INTERIORS]);
  const saved = records[INTERIORS].interiors;
  expect(gunzipSync(Buffer.from(saved[0].gz, 'base64'))).toEqual(Buffer.from(tiles));
  expect(saved[0].parts).toEqual(map.parts);
  expect(saved[1]).toEqual(untouched);
  await page.reload();
  await page.getByRole('button', { name: /岸辺の庭.*16²/ }).click();
  expect(await editor.locator('[data-shore-mask]').evaluateAll(shoreMarkup)).toEqual(shapes);
  await page.goto(`${URL}?screen=world`);
  const world = page.getByLabel('ワールドマップ', { exact: true });
  await expect(world).toBeVisible();
  await expect(world.locator('[data-shore-mask="0"]')).toHaveCount(1);
  expect(await world.locator('[data-shore-mask]').evaluateAll(shoreMarkup)).toEqual(shapes);
  await page.screenshot({ path: 'test-results/shore-world-mobile.png' });
  expect(errors).toEqual([]);
});

test('field wraps with mixed sand/snow custom art, equal masks and a bridge; save/reload matches World', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1000, height: 1100 });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  const tiles = new Uint8Array(WORLD_SIZE * WORLD_SIZE);
  tiles[1023] = 8; tiles[0] = 8; tiles[1] = 9;
  const parts = [...BASE_PARTS, { terrain: 'water', name: '増設水', walkable: false }, { terrain: 'bridge', name: '増設橋', walkable: true }, { terrain: 'plains', name: '自作砂地', walkable: true }, { terrain: 'plains', name: '自作雪', walkable: true }];
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    const i = ((y + WORLD_SIZE) % WORLD_SIZE) * WORLD_SIZE + (x + WORLD_SIZE) % WORLD_SIZE;
    if (tiles[i] === 0) tiles[i] = y < 0 ? 10 : 11;
  }
  tiles[(WORLD_SIZE - 2) * WORLD_SIZE + WORLD_SIZE - 2] = 3; // sand pool
  tiles[2 * WORLD_SIZE + 2] = 3; // same shape/part, snow pool
  const collection = 'app.aozoraquest.world.map';
  const records: Record<string, any> = {
    'app.aozoraquest.world.tileArt': { arts: { 'part:10': encodeTileArt(sandArt), 'part:11': encodeTileArt(snowArt) } },
    [collection]: { size: WORLD_SIZE, gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64'), parts },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 30, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: 0, y: 2, regions: [], visitedTowns: [], gotStarterFeather: true, hp: null, mp: null },
  };
  let saves = 0;
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/shore-fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        const value = records[params.collection];
        await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') {
        if (params.collection === collection) saves++;
        records[params.collection] = params.record;
        await route.fulfill({ json: { uri: 'at://isolated/record' } });
      } else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (url.pathname === '/shore-fixture-api/api/me/state') {
      await route.fulfill({ json: { state: { did: 'did:plc:shoreadmin', power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 2, version: 1, updatedAt: '' }, initialized: false } }); return;
    }
    if (url.pathname.startsWith('/shore-fixture-api/')) { await route.abort(); return; }
    await route.continue();
  });
  await page.goto(`${URL}?screen=field`);
  const editor = page.getByLabel('フィールドマップを編集');
  await expect(editor).toBeVisible();
  const jumpToEdge = async () => {
    const overview = page.locator('canvas').first();
    await overview.scrollIntoViewIfNeeded();
    const b = (await overview.boundingBox())!;
    await page.mouse.click(b.x + 0.1, b.y + 0.1);
    await editor.scrollIntoViewIfNeeded();
  };
  await jumpToEdge();
  // At x=0 water sees the added bridge to the east and x=1023 water to the west.
  await expect(editor.locator('[data-shore-mask="10"]')).toHaveCount(1);
  await page.getByTitle(/\(pond\)/).click();
  await editor.scrollIntoViewIfNeeded();
  const b = (await editor.boundingBox())!;
  await page.mouse.click(b.x + 8.5 * b.width / 16, b.y + 9.5 * b.height / 16);
  tiles[WORLD_SIZE] = 3;
  const shapes = await editor.locator('[data-shore-mask]').evaluateAll(shoreMarkup);
  expect(shapes.join('')).toContain(sandArt.palette[0]);
  expect(shapes.join('')).toContain(snowArt.palette[0]);
  const pools = await editor.locator('[data-shore-mask="0"]').evaluateAll(shoreMarkup);
  expect(pools).toHaveLength(2);
  expect(pools.filter((s) => s.includes(sandArt.palette[0]!))).toHaveLength(1);
  expect(pools.filter((s) => s.includes(snowArt.palette[0]!))).toHaveLength(1);
  await expect(editor.locator('[data-shore-mask] [clip-path] rect[width="1"]')).not.toHaveCount(0);
  expect(shapes.join('')).not.toContain('#3f9d3f');
  expect(saves).toBe(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => saves).toBe(1);
  expect(gunzipSync(Buffer.from(records[collection].gz, 'base64'))).toEqual(Buffer.from(tiles));
  expect(records[collection].parts).toEqual(parts);
  await page.screenshot({ path: 'test-results/shore-field-editor.png' });
  await page.reload(); await jumpToEdge();
  expect(await editor.locator('[data-shore-mask]').evaluateAll(shoreMarkup)).toEqual(shapes);
  // Returning from art editing must refresh the shore/custom-art choice without a reload or paint.
  await page.getByRole('button', { name: 'パーツの絵', exact: true }).click();
  await page.getByRole('combobox').first().selectOption('8');
  await page.locator('section div[style*="cursor: crosshair"]').first().click();
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  await expect(page.getByText(/地形ぶんを保存した/)).toBeVisible();
  await page.getByRole('button', { name: '地図を編集', exact: true }).click();
  await expect(editor.locator('[id="ed-8-water-plain"]')).toHaveCount(1);
  await expect(editor.locator('[id^="ed-8-water-"] [data-shore-mask]')).toHaveCount(0);
  await page.getByRole('button', { name: 'パーツの絵', exact: true }).click();
  await page.getByRole('combobox').first().selectOption('8');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '同梱の絵に戻す', exact: true }).click();
  await expect(page.getByText(/同梱の絵に戻した/)).toBeVisible();
  await page.getByRole('button', { name: '地図を編集', exact: true }).click();
  expect(await editor.locator('[data-shore-mask]').evaluateAll(shoreMarkup)).toEqual(shapes);
  expect(saves).toBe(3); // existing art persistence also saves the loaded map
  expect(gunzipSync(Buffer.from(records[collection].gz, 'base64'))).toEqual(Buffer.from(tiles));
  expect(records[collection].parts).toEqual(parts);
  await page.goto(`${URL}?screen=world`);
  const world = page.getByLabel('ワールドマップ', { exact: true });
  await expect(world.locator('[data-shore-mask]')).toHaveCount(shapes.length);
  expect(await world.locator('[data-shore-mask]').evaluateAll(shoreMarkup)).toEqual(shapes);
});

test('ground art comparison: grass, custom sand, 32px snow and mixed shores', async ({ page }) => {
  await page.route('**/*', (route) => ['127.0.0.1', 'localhost'].includes(new globalThis.URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1160, height: 1040 });
  await page.goto(`${URL}?screen=art`);
  await expect(page.getByRole('heading', { name: /下地をそのまま/ })).toBeVisible();
  await page.locator('main').screenshot({ path: 'test-results/shore-ground-comparison.png', animations: 'disabled' });
});
