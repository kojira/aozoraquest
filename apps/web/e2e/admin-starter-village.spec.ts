import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { encodeWorldMap, starterTownInterior, starterTownGates, starterTownNpcs, worldOverlay } from '@aozoraquest/core';

let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4273/e2e/fixtures/admin-starter-village.html';
const INTERIORS = 'app.aozoraquest.world.interiors';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:villageadmin') },
    server: { host: '127.0.0.1', port: 4273, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('slow saved-village load cannot overwrite starter insertion; save then quests uses persisted 32x32 village', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(8_000);
  page.on('dialog', (dialog) => void dialog.accept());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const town = worldOverlay().spawn;
  const village = starterTownInterior(town);
  const { tiles: _tiles, ...metadata } = village;
  const oldVillage = { ...metadata, size: 64, gz: Buffer.from(await encodeWorldMap(new Uint8Array(64 * 64))).toString('base64') };
  const untouched = { id: 'custom-room', name: '手作りの部屋', size: 4, gz: Buffer.from(await encodeWorldMap(new Uint8Array(16))).toString('base64') };
  const npcs = { npcs: starterTownNpcs() };
  const records: Record<string, unknown> = { [INTERIORS]: { interiors: [oldVillage, untouched], gates: starterTownGates(town) }, 'app.aozoraquest.world.npcs': npcs };
  const puts: Array<{ collection: string; record: { interiors: typeof oldVillage[]; gates: unknown[] } }> = [];
  let reads = 0;
  let releaseLoad: (() => void) | undefined;
  let releaseSave: (() => void) | undefined;
  let failSave = true;
  let failRead = false;
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname !== '/village-fixture-pds') { await route.continue(); return; }
    const { op, params } = route.request().postDataJSON();
    if (op === 'get') {
      if (failRead) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
      const record = records[params.collection];
      // Delay the final strict read, after the general authored-world load has completed.
      if (params.collection === INTERIORS && ++reads === 2) await new Promise<void>((resolve) => { releaseLoad = resolve; });
      await route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'isolated-cid' } : { error: 'RecordNotFound' } });
    } else if (op === 'put') {
      puts.push(params);
      if (failSave) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      records[params.collection] = params.record;
      await route.fulfill({ json: { uri: 'at://isolated/record', cid: 'saved-cid' } });
    } else await route.fulfill({ json: { records: [] } });
  });
  try {
    await page.goto(URL);
    await expect.poll(() => !!releaseLoad).toBe(true);
    const insert = page.getByRole('button', { name: 'はじまりの村を入れる', exact: true });
    await expect(insert).toBeDisabled();
    await expect(page.getByRole('button', { name: '＋マップ', exact: true })).toBeDisabled();
    releaseLoad!();
    await expect(insert).toBeEnabled();
    await expect(page.getByRole('button', { name: /ふたばの村.*64²/ })).toBeVisible();
    await insert.click();
    await expect(page.getByRole('spinbutton', { name: 'おおきさ' })).toHaveValue('32');
    const save = page.getByRole('button', { name: '保存', exact: true });
    await save.click();
    await expect(page.getByText(/保存できなかった/)).toBeVisible();
    await expect(save).toBeEnabled();
    expect(records[INTERIORS]).toEqual({ interiors: [oldVillage, untouched], gates: starterTownGates(town) });
    await expect(page.getByRole('spinbutton', { name: 'おおきさ' })).toHaveValue('32');
    failSave = false;
    await save.click();
    await expect.poll(() => !!releaseSave).toBe(true);
    await expect(insert).toBeDisabled();
    await expect(page.getByRole('spinbutton', { name: 'おおきさ' })).toBeDisabled();
    const map = page.locator('svg[viewBox="0 0 1024 1024"]');
    const beforePaint = await map.innerHTML();
    await map.dispatchEvent('pointerdown', { clientX: 80, clientY: 500, pointerId: 1, shiftKey: true });
    expect(await map.innerHTML()).toBe(beforePaint);
    await expect(page.getByText(/ゲートの出口を選ぶ/)).toHaveCount(0);
    releaseSave!();
    await expect(page.getByText(/2 マップ.*を保存した/)).toBeVisible();
    expect(puts.map((p) => p.collection)).toEqual([INTERIORS, INTERIORS]);
    const saved = puts[1]!.record;
    const savedVillage = saved.interiors.find((m) => m.id === village.id)!;
    expect(savedVillage.size).toBe(32);
    expect(gunzipSync(Buffer.from(savedVillage.gz, 'base64'))).toEqual(Buffer.from(village.tiles));
    expect(saved.interiors.find((m) => m.id === untouched.id)).toEqual(untouched);
    expect(records['app.aozoraquest.world.npcs']).toEqual(npcs);
    await page.screenshot({ path: 'test-results/starter-village-saved-mobile.png' });
    await page.getByRole('link', { name: '← 管理', exact: true }).click();
    await page.getByRole('link', { name: 'クエスト管理へ' }).click();
    const insertQuests = page.getByRole('button', { name: 'ふたばの村のクエストを入れる', exact: true });
    await expect(insertQuests).toBeEnabled();
    await insertQuests.click();
    await expect(page.getByText(/旧版 \(64×64\)/)).toHaveCount(0);
    await expect(page.getByText(/3依頼を入れた/)).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await page.screenshot({ path: 'test-results/starter-village-quests-mobile.png' });
    failRead = true;
    await page.reload();
    await expect(page.getByText(/保存済みの内部マップを読み込めなかった/)).toBeVisible();
    await expect(insert).toBeDisabled();
    await expect(page.getByRole('button', { name: '＋マップ', exact: true })).toBeDisabled();
    await expect(save).toBeDisabled();
    expect(puts).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally { releaseLoad?.(); releaseSave?.(); await context.close(); }
});
