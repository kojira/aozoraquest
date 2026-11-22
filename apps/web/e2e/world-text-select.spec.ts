import { test, expect, type Locator } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { worldOverlay, setInteriors, setNpcs, setGameQuests, setScenario, type NpcDef } from '@aozoraquest/core';

// #996: スマホでワールドの文字 (ヘッダー・会話・HUD) が選択されると、そのあと移動できなくなることがある。
// ワールドを開いている間は 画面全体で文字選択が始まらず、入力欄だけは選べる。選択が残っていても 歩き出せば消える。
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
    }, server: { host: '127.0.0.1', port: 4195, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** 要素の文字を選択し始められるか (selectstart が止められず、user-select が none でない)。 */
const selectable = (target: Locator) => target.evaluate((el) => {
  const ev = new Event('selectstart', { bubbles: true, cancelable: true });
  (el.firstChild ?? el).dispatchEvent(ev);
  return { prevented: ev.defaultPrevented, userSelect: getComputedStyle(el).userSelect };
});

test('ワールドでは文字選択が始まらず、入力欄は選べ、選択が残っていても歩ける', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(5_000);
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  const npc: NpcDef = { id: 'select-tester', name: 'たびのひと', x: start.x - 1, y: start.y, lines: ['ながい ながい せりふ'] };
  setInteriors([], []); setNpcs([npc]); setGameQuests([]); setScenario([]);
  const did = 'did:plc:tutorial', now = 1_700_000_000;
  const env = await tutorialEnv(now);
  let state: GameState = { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const records: Record<string, unknown> = {
    'app.aozoraquest.dev.world.npcs': { npcs: [npc] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
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
    if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    try {
      if (!url.pathname.endsWith('/move')) throw new Error(`Unexpected fixture API ${url.pathname}`);
      moves++;
      const body = route.request().postDataJSON();
      await route.fulfill({ json: await handleMove(env, did, body.dx, body.dy, body.token, now) });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.goto('http://127.0.0.1:4195/e2e/fixtures/world-shell.html');
  const map = page.getByLabel('ワールドマップ', { exact: true });
  await expect(map).toBeVisible();
  await expect(page.getByText('HP', { exact: true })).toBeVisible();

  // 1. .world-screen の外 (ヘッダー・footer) も、中 (HUD) も 選択が始まらない
  for (const [name, target] of [['ヘッダー', page.locator('.header strong')], ['footer', page.locator('.footer-nav')], ['HUD', page.getByText('HP', { exact: true })]] as const) {
    expect(await selectable(target), name).toEqual({ prevented: true, userSelect: 'none' });
  }
  // 2. 入力欄は選べるまま
  const inputSelectable = await page.evaluate(() => {
    const input = document.createElement('input');
    input.value = 'ねだん 120';
    document.querySelector('.world-screen')!.appendChild(input);
    const ev = new Event('selectstart', { bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    const result = { prevented: ev.defaultPrevented, userSelect: getComputedStyle(input).userSelect };
    input.remove();
    return result;
  });
  expect(inputSelectable).toEqual({ prevented: false, userSelect: 'text' });

  // 3. 会話の窓の文字も選択が始まらない (左の NPC に話しかける)
  await expect(async () => {
    if (await page.getByRole('dialog', { name: 'セリフ', exact: true }).count() === 0) await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.aq-dialogue-pane').last()).toContainText('ながい', { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  expect(await selectable(page.locator('.aq-dialogue-pane').last())).toEqual({ prevented: true, userSelect: 'none' });
  await page.locator('.aq-dialogue-pane').last().click();
  await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toHaveCount(0);

  // 4. 選択が残っていても スティックで歩け、選択は消える
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.header strong')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  // user-select: none の文字は toString() が空になるので、範囲そのもの (isCollapsed) を見る
  const hasSelection = () => page.evaluate(() => getSelection()!.rangeCount > 0 && !getSelection()!.isCollapsed);
  expect(await hasSelection()).toBe(true);
  const m = (await map.boundingBox())!;
  const worldY = () => page.locator('[data-world-scroll]').getAttribute('data-world-y').then(Number);
  const y0 = await worldY(), moves0 = moves;
  const cdp = await page.context().newCDPSession(page);
  const cx = m.x + m.width / 2 + 60, cy = m.y + m.height / 2 + 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let d = 8; d <= 40; d += 8) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + d }] });
  await expect.poll(worldY).toBeGreaterThan(y0);
  expect(moves).toBeGreaterThan(moves0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  expect(await hasSelection()).toBe(false);

  // 5. ワールドを出たら (タイムラインなど) 文字は選べる
  await page.getByRole('link', { name: 'クエスト', exact: true }).click();
  const board = page.getByText('クエスト掲示板 (fixture)');
  await expect(board).toBeVisible();
  expect(await selectable(board)).toEqual({ prevented: false, userSelect: 'auto' });
});
