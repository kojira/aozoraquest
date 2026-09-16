import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { BASE_PARTS, encodeTileArt, encodeWorldMap, WORLD_SIZE, setWorldMap, setInteriors, setNpcs, setGameQuests, setScenario, tileArtFor } from '@aozoraquest/core';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';

let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4282/e2e/fixtures/new-biomes.html';
const INTERIORS = 'app.aozoraquest.world.interiors', FIELD = 'app.aozoraquest.world.map';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:shoreadmin'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/shore-fixture-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:shore.invalid') },
    server: { host: '127.0.0.1', port: 4282, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

for (const field of [false, true]) test(`${field ? 'field' : 'interior'}: add/paint/save/reload new biomes and move with the actual authority`, async ({ page }) => {
  test.setTimeout(120_000); page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: field ? 1000 : 390, height: field ? 1100 : 844 });
  await page.addInitScript(() => {
    for (const key of ['aq-world-onboarding-done', 'aq-world-menu-hint-done', 'aq-world-stick-hint-done']) localStorage.setItem(key, '1');
  });
  const size = field ? WORLD_SIZE : 16, x = field ? 0 : 7, y = field ? 0 : 7;
  const tiles = new Uint8Array(size * size);
  tiles[5 * size + 5] = 3; // pond beside the new snowfield; terrain indices stay intact
  tiles[4 * size + 4] = 8; // existing custom part must not be overwritten
  const oldParts = [...BASE_PARTS, { terrain: 'bridge', name: '既存の橋', walkable: true }];
  const map = { id: 'biome-garden', name: '雪と砂の庭', size, parts: oldParts, gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64') };
  const untouched = { id: 'untouched', name: '別の部屋', size: 4, gz: Buffer.from(await encodeWorldMap(new Uint8Array(16))).toString('base64') };
  const art = encodeTileArt({ size: 16, palette: ['', '#945671'], pixels: new Uint8Array(256).fill(1) });
  const diag = { archetype: 'warrior', rpgStats: { atk: 30, def: 15, agi: 15, int: 15, luk: 15 } };
  const records: Record<string, any> = {
    [FIELD]: field ? { size, parts: oldParts, gz: map.gz } : undefined,
    [INTERIORS]: { interiors: field ? [untouched] : [map, untouched], gates: [] },
    'app.aozoraquest.world.tileArt': { arts: { 'part:8': art } },
    'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x, y, regions: [], visitedTowns: [], gotStarterFeather: true, hp: null, mp: null },
  };
  const did = 'did:plc:shoreadmin', now = 1_700_000_000;
  const env = await tutorialEnv(now);
  let state: GameState = { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [],
    ...(field ? {} : { mapId: map.id }), x, y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('pds.fixture.invalid') && url.includes('getRecord')) return Response.json({ cid: 'fixture', value: state });
    if (url.includes('pds.fixture.invalid') && url.includes('putRecord')) { state = JSON.parse(init.body as string).record; return Response.json({ cid: 'saved' }); }
    if (url.includes('getRecord') && url.includes('analysis')) return Response.json({ value: diag });
    throw new Error('External request forbidden in biome test');
  }) as typeof fetch;
  const puts: string[] = [], errors: string[] = [], moved: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
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
    if (url.pathname.endsWith('/move')) {
      const body = route.request().postDataJSON();
      try {
        const result = await handleMove(env, did, body.dx, body.dy, body.token, now);
        moved.push(result.terrain); state = { ...state, x: result.x, y: result.y, mapId: result.mapId };
        await route.fulfill({ json: result });
      } catch (e) { await route.fulfill({ status: 400, json: { message: (e as Error).message } }); }
      return;
    }
    if (url.pathname.startsWith('/shore-fixture-api/')) { await route.fulfill({ json: { state } }); return; }
    await route.continue();
  });
  try {
    await page.goto(`${URL}${field ? '?screen=field' : ''}`);
    if (!field) await page.getByRole('button', { name: /雪と砂の庭.*16²/ }).click();
    const editor = page.getByLabel(field ? 'フィールドマップを編集' : '内部マップを編集');
    const locate = async () => {
      if (field) { const overview = page.locator('canvas').first(); await overview.scrollIntoViewIfNeeded(); const b = (await overview.boundingBox())!; await page.mouse.click(b.x + 0.1, b.y + 0.1); }
      await editor.scrollIntoViewIfNeeded();
    };
    await locate();
    const paint = async (cx: number, cy: number) => {
      await editor.scrollIntoViewIfNeeded(); const b = (await editor.boundingBox())!;
      await page.mouse.click(b.x + (cx + 0.5) * b.width / 16, b.y + (cy + 0.5) * b.height / 16);
    };
    for (const [name, index, offset] of [['雪原', 9, 1], ['雪山', 10, 3], ['砂漠', 11, 2]] as const) {
      await page.getByRole('button', { name: `${name}を追加`, exact: true }).click();
      await paint(field ? 8 + offset : x + offset, field ? 8 : y);
      tiles[y * size + x + offset] = index;
      // A visible patch around a pond also exercises shore ground selection for real new terrain IDs.
      if (!field) for (let cy = 3; cy <= 5; cy++) {
        const cx = index === 9 ? 6 : index === 10 ? 8 : 10;
        await paint(cx, cy); tiles[cy * size + cx] = index;
      }
    }
    expect(puts).toEqual([]);
    const beforeSave = await editor.locator('defs').first().innerHTML();
    await page.screenshot({ path: `test-results/biomes-${field ? 'field' : 'interior'}-editor.png`, fullPage: true });
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText(/保存した/)).toBeVisible();
    expect(puts).toEqual([field ? FIELD : INTERIORS]);
    const saved = field ? records[FIELD] : records[INTERIORS].interiors[0];
    expect(gunzipSync(Buffer.from(saved.gz, 'base64'))).toEqual(Buffer.from(tiles));
    expect(saved.parts.slice(0, 9)).toEqual(oldParts);
    expect(saved.parts.slice(9).map((p: any) => p.terrain)).toEqual(['snowfield', 'snowMountain', 'desert']);
    expect(records['app.aozoraquest.world.tileArt'].arts['part:8']).toEqual(art);
    expect(records[INTERIORS].interiors.at(-1)).toEqual(untouched);
    await page.reload();
    if (!field) await page.getByRole('button', { name: /雪と砂の庭.*16²/ }).click();
    await locate();
    expect(await editor.locator('defs').first().innerHTML()).toEqual(beforeSave);
    // Authority consumes exactly the record saved by the real editor, using the real codecs/types.
    const loaded = { ...saved, tiles: new Uint8Array(gunzipSync(Buffer.from(saved.gz, 'base64'))) };
    if (field) { setWorldMap(loaded); setInteriors([], []); } else setInteriors([loaded], []);
    setNpcs([]); setGameQuests([]); setScenario([]);
    await page.goto(`${URL}?screen=world`);
    const world = page.getByLabel('ワールドマップ', { exact: true }); await expect(world).toBeVisible();
    for (const terrain of ['snowfield', 'snowMountain', 'desert']) {
      expect(await world.locator('defs').first().innerHTML()).toContain(tileArtFor(terrain)!.palette[1]!);
    }
    if (!field) expect(await world.locator('[data-shore-mask]').evaluateAll(els => els.map(e => e.outerHTML).join(''))).toContain('#e7f3fa');
    await page.keyboard.press('ArrowRight'); await expect.poll(() => state.x).toBe(x + 1);
    const layer = world.locator('[data-world-scroll]');
    await expect(layer).not.toHaveAttribute('transform', 'translate(0 0)');
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await page.keyboard.press('ArrowRight'); await expect.poll(() => state.x).toBe(x + 2);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    expect(moved).toEqual(['snowfield', 'desert']);
    await page.keyboard.press('ArrowRight'); await expect(page.getByText('そっちには進めない!')).toBeVisible();
    expect(state.x).toBe(x + 2);
    // Even bypassing the client's guard cannot walk through a snow mountain.
    await expect(handleMove(env, did, 1, 0, undefined, now)).rejects.toThrow('進めない地形');
    await page.screenshot({ path: `test-results/biomes-${field ? 'field' : 'interior'}-world.png` });
    expect(errors).toEqual([]);
  } finally { globalThis.fetch = originalFetch; setWorldMap(null); setInteriors([], []); }
});

test('base-only interior can explicitly add biomes; legacy shared art blocks only the new addition', async ({ page }) => {
  const original = { id: 'base-room', name: '基本の部屋', size: 4, gz: Buffer.from(await encodeWorldMap(new Uint8Array(16))).toString('base64') };
  const records: Record<string, any> = { [INTERIORS]: { interiors: [original], gates: [] } };
  let puts = 0;
  await page.route('**/*', async route => {
    const url = new globalThis.URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname !== '/shore-fixture-pds') { await route.continue(); return; }
    const { op, params } = route.request().postDataJSON();
    if (op === 'get') { const value = records[params.collection]; await route.fulfill({ status: value ? 200 : 404, json: value ? { value } : { error: 'RecordNotFound' } }); }
    else if (op === 'put') { puts++; records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://isolated/record' } }); }
    else await route.fulfill({ json: { records: [] } });
  });
  await page.goto(URL); await page.getByRole('button', { name: /基本の部屋.*4²/ }).click();
  await page.getByRole('button', { name: '雪原を追加', exact: true }).click();
  await expect(page.getByTitle('雪原', { exact: true })).toBeVisible();
  expect(puts).toBe(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/1 マップ.*を保存した/)).toBeVisible();
  expect(records[INTERIORS].interiors[0].parts).toEqual([...BASE_PARTS, { terrain: 'snowfield', name: '雪原' }]);
  expect(records[INTERIORS].interiors[0].gz).toBe(original.gz);
  records[INTERIORS] = { interiors: [original], gates: [] };
  records['app.aozoraquest.world.tileArt'] = { arts: { 'part:0': encodeTileArt(tileArtFor('desert')!) } };
  await page.reload(); await page.getByRole('button', { name: /基本の部屋.*4²/ }).click();
  await page.getByRole('button', { name: '雪原を追加', exact: true }).click();
  await expect(page.getByText(/共有パーツを使用しているため/)).toBeVisible();
  await expect(page.getByTitle('雪原', { exact: true })).toHaveCount(0);
  expect(puts).toBe(1);
  await page.getByTitle('forest', { exact: true }).click();
  const b = (await page.getByLabel('内部マップを編集').boundingBox())!;
  await page.mouse.click(b.x + b.width / 8, b.y + b.height / 8);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText(/1 マップ.*を保存した/)).toBeVisible();
  expect(puts).toBe(2); expect(records[INTERIORS].interiors[0].parts).toBeUndefined();
  expect(gunzipSync(Buffer.from(records[INTERIORS].interiors[0].gz, 'base64'))[0]).toBe(2);
});

test('original biome art and shoreline gallery', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto(`${URL}?screen=art`);
  await expect(page.getByRole('heading', { name: '雪原・雪山・砂漠' })).toBeVisible();
  await page.locator('main').screenshot({ path: 'test-results/new-biomes-art.png' });
});
