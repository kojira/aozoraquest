import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { worldOverlay, starterTownInterior, starterTownGates, setInteriors, setNpcs,
  setGameQuests, setScenario, regionsAround, encodeWorldMap } from '@aozoraquest/core';
const ONBOARDING_DONE_KEY = 'aq-world-onboarding-done';

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
    }, server: { host: '127.0.0.1', port: 4176, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

for (const gated of [false, true]) test(`World + handleMove: ${gated ? 'gate' : 'field'} arrival survives held movement`, async ({ page }) => {
  test.setTimeout(45_000);
  page.setDefaultTimeout(5_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = gated ? starterTownGates(town) : [];
  setInteriors(gated ? [village] : [], gates); setNpcs([]); setGameQuests([]); setScenario([]);
  const did = 'did:plc:tutorial', now = 1_700_000_000;
  const env = await tutorialEnv(now);
  let state: GameState = { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [],
    x: town.x, y: town.y + 1, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  let cid = 'initial', revision = 0;
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('pds.fixture.invalid') && url.includes('getRecord')) return Response.json({ cid, value: state });
    if (url.includes('pds.fixture.invalid') && url.includes('putRecord')) {
      const body = JSON.parse(init.body as string);
      if (body.swapRecord && body.swapRecord !== cid) return Response.json({ error: 'InvalidSwap' }, { status: 400 });
      state = body.record; cid = `r${++revision}`; return Response.json({ cid });
    }
    if (url.includes('getRecord') && url.includes('analysis')) return Response.json({ value: diag });
    throw new Error('External request forbidden in town arrival test');
  }) as typeof fetch;
  const records: Record<string, any> = {
    'app.aozoraquest.world.interiors': { interiors: gated ? [{ ...village, tiles: undefined,
      gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }] : [], gates },
    'app.aozoraquest.world.npcs': { npcs: [] }, 'app.aozoraquest.world.quests': { quests: [] },
    'app.aozoraquest.world.scenario': { events: [] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: town.x, y: town.y + 1, gotStarterFeather: true,
      regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  let moves = 0, failSave = false;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        const value = records[params.collection];
        await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') {
        if (failSave && params.collection.endsWith('.world')) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
        records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://fixture/record' } });
      } else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    const body = route.request().postDataJSON();
    try {
      if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
      if (!url.pathname.endsWith('/move')) throw new Error('Unexpected fixture API');
      moves++;
      await route.fulfill({ json: await handleMove(env, did, body.dx, body.dy, body.token, now) });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((key) => localStorage.setItem(key, '1'), ONBOARDING_DONE_KEY);
    await page.goto('http://127.0.0.1:4176/e2e/fixtures/tutorial.html');
    const map = page.getByLabel('ワールドマップ', { exact: true });
    await expect(map).toBeVisible();
    // Actual virtual-stick gesture remains held across town arrival.
    const b = (await map.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 40);
    await expect.poll(() => records['app.aozoraquest.test.world'].regions.length).toBe(9);
    // Existing code loses the notice on the next 170ms stick tick; the map was saved anyway.
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toBeVisible();
    await expect(page.locator('.aq-dialogue-pane')).toContainText('ちずのかけらを 手に入れた!');
    await page.waitForTimeout(550); // More than three real stick intervals, not a network wait.
    expect(moves).toBe(1);
    await page.keyboard.down('ArrowUp');
    await page.screenshot({ path: `test-results/town-map-${gated ? 'gate' : 'field'}.png` });
    await page.mouse.up();
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: true })));
    await page.waitForTimeout(200);
    expect(moves).toBe(1); // Neither old stick interval nor held keyboard resumes after dismissal.
    await page.keyboard.up('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => moves).toBe(2);
    expect(records['app.aozoraquest.test.world'].regions).toEqual(regionsAround(town.region).sort((a, b) => a - b));
    expect(records['app.aozoraquest.test.world'].visitedTowns).toEqual([{ x: town.x, y: town.y }]);
    // Reload retains fragments and does not synthesize another acquisition event.
    await page.reload(); await expect(map).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);
    const restoredMap = (await map.boundingBox())!;
    await page.mouse.click(restoredMap.x + restoredMap.width / 2, restoredMap.y + restoredMap.height / 2);
    await expect(page.getByRole('dialog', { name: 'コマンド' })).toBeVisible();
    if (gated) {
      await expect(page.getByRole('button', { name: 'ちず', exact: true })).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'ちず', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '世界地図' })).toBeVisible();
      await page.screenshot({ path: 'test-results/town-map-reloaded.png' });
    }
    await page.keyboard.press('Escape');
    // Test-only approach checkpoint, same revealed regions: first visit flag alone is not a fragment.
    state = { ...state, mapId: undefined, x: town.x, y: town.y + 1 };
    records['app.aozoraquest.test.world'].visitedTowns = [];
    await page.reload(); await expect(map).toBeVisible();
    await page.keyboard.press('ArrowUp'); await expect.poll(() => moves).toBe(3);
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);
    await expect(page.locator('p[aria-live="polite"]')).toContainText(gated ? 'ついた!' : '休んで');
    // A failed exploration-memo save must not lock input or loop the acquisition window.
    state = { ...state, mapId: undefined, x: town.x, y: town.y + 1 };
    records['app.aozoraquest.test.world'].regions = [town.region]; failSave = true;
    await page.reload(); await expect(map).toBeVisible();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toBeVisible();
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);
    await page.keyboard.press('ArrowDown'); await expect.poll(() => moves).toBe(5);
    expect(errors).toEqual([]);
  } finally { globalThis.fetch = originalFetch; }
});
