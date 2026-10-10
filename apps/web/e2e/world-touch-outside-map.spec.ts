import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { worldOverlay, setInteriors, setNpcs, setGameQuests, setScenario, type NpcDef } from '@aozoraquest/core';

// スマホでマップの下の黒い領域 (footer まで) からも移動スティックが効く (タップは無反応)。
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
    }, server: { host: '127.0.0.1', port: 4182, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function touch(page: Page, x: number, y: number, dragUp = 0, holdMs = 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let dy = 8; dy <= dragUp; dy += 8) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy }] });
  if (holdMs) await page.waitForTimeout(holdMs);
  return async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); };
}

test('マップの下の黒い領域: ドラッグで歩き、タップは何もしない、会話送り・footer は従来どおり', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(5_000);
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  const npc: NpcDef = { id: 'touch-tester', name: 'たびのひと', x: start.x - 1, y: start.y, lines: ['いちまいめ', 'にまいめ'] };
  setInteriors([], []); setNpcs([npc]); setGameQuests([]); setScenario([]);
  const did = 'did:plc:tutorial', now = 1_700_000_000;
  const env = await tutorialEnv(now);
  let state: GameState = { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const records: Record<string, unknown> = {
    'app.aozoraquest.dev.world.npcs': { npcs: [npc] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  let cid = 'initial', revision = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('pds.fixture.invalid') && url.includes('getRecord')) {
      return url.includes('analysis') ? Response.json({ value: diag }) : Response.json({ cid, value: state });
    }
    if (url.includes('pds.fixture.invalid') && url.includes('putRecord')) {
      state = JSON.parse(init.body as string).record; cid = `r${++revision}`; return Response.json({ cid });
    }
    throw new Error('External request forbidden in touch-outside test');
  }) as typeof fetch;
  let moves = 0;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      const value = op === 'get' ? records[params.collection] : undefined;
      if (op === 'get') await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } });
      else if (op === 'put') { records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://fixture/record' } }); }
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    const body = route.request().postDataJSON();
    try {
      if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
      if (!url.pathname.endsWith('/move')) throw new Error(`Unexpected fixture API ${url.pathname}`);
      moves++;
      await route.fulfill({ json: await handleMove(env, did, body.dx, body.dy, body.token, now) });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  try {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.goto('http://127.0.0.1:4182/e2e/fixtures/world-shell.html');
  const map = page.getByLabel('ワールドマップ', { exact: true });
  await expect(map).toBeVisible();
  const worldY = () => page.locator('[data-world-scroll]').getAttribute('data-world-y').then(Number);
  await expect.poll(worldY).toBe(start.y);
  const m = (await map.boundingBox())!, foot = (await page.locator('.footer-nav').boundingBox())!;
  // 5. 黒い領域は footer まで world の要素で埋まり、ページはスクロールしない
  const root = (await page.locator('.world-screen').boundingBox())!;
  expect(Math.abs(root.y + root.height - foot.y)).toBeLessThanOrEqual(12);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight + 1)).toBe(true);
  const black = { x: m.x + m.width / 2, y: (m.y + m.height + foot.y) / 2 };
  // 6. 操作説明文は出さない。スティック外の左 36px の帯からドラッグしても文字は選ばれない
  await expect(page.getByText(/じぶんを タップすると|マップや その下を|やどやで パワーを|歩くとモンスターが/)).toHaveCount(0);
  const warn = (await page.getByText(/パワーが ない/).boundingBox())!;
  await page.screenshot({ path: 'test-results/world-no-help-390.png' });
  await page.mouse.move(root.x + 18, m.y + m.height + 12);
  await page.mouse.down();
  await page.mouse.move(root.x + 18, warn.y + warn.height + 4, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()!.toString())).toBe('');
  expect(foot.y - (m.y + m.height)).toBeGreaterThan(150);
  // 2. 黒い領域のタップではメニューが出ない (歩きもしない)
  await (await touch(page, black.x, black.y))();
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: 'コマンド' })).toHaveCount(0);
  expect(moves).toBe(0);
  // 1. 黒い領域から上へドラッグで歩き続け、離すと止まる
  const release = await touch(page, black.x, black.y, 40, 450);
  // 基準リング (88px の円) が黒い領域の押した位置に出ている
  const ringY = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.world-screen [aria-hidden]')]
    .filter((e) => e.style.width === '88px' && e.style.borderRadius === '50%').map((e) => e.getBoundingClientRect()).map((r) => r.y + r.height / 2));
  expect(ringY).toHaveLength(1);
  expect(ringY[0]!).toBeGreaterThan(m.y + m.height);
  await page.screenshot({ path: 'test-results/touch-outside-map-390.png' });
  await release();
  await expect.poll(worldY).toBeLessThan(start.y - 1);
  await page.waitForTimeout(250);
  const stopped = await worldY(), stoppedMoves = moves;
  await page.waitForTimeout(500);
  expect(await worldY()).toBe(stopped);
  expect(moves).toBe(stoppedMoves);
  // 2b. 地図中央のタップは従来どおりメニューを開く
  await (await touch(page, m.x + m.width / 2, m.y + m.height / 2))();
  await expect(page.getByRole('dialog', { name: 'コマンド' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'コマンド' })).toHaveCount(0);
  // 3. 会話中に黒い領域をタップすると会話が進む
  for (let i = 0; i < start.y - stopped; i++) { await page.keyboard.press('ArrowDown'); await expect.poll(worldY).toBe(stopped + i + 1); }
  await page.keyboard.press('ArrowLeft');
  const pane = page.locator('.aq-dialogue-pane').last();
  await expect(pane).toContainText('いちまいめ');
  await (await touch(page, black.x, black.y))();
  await expect(pane).toContainText('にまいめ');
  await (await touch(page, black.x, black.y))();
  await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);
  // 4. footer のタブは押せる
  const tab = (await page.getByRole('link', { name: 'クエスト', exact: true }).boundingBox())!;
  await (await touch(page, tab.x + tab.width / 2, tab.y + tab.height / 2))();
  await expect(page.getByText('クエスト掲示板 (fixture)')).toBeVisible();
  expect(errors).toEqual([]);
  } finally { globalThis.fetch = originalFetch; }
});
