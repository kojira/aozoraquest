import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { BASE_PARTS, encodeTileArt, encodeWorldMap, emptyTileArt, starterTownInterior, starterTownGates, starterTownNpcs, worldOverlay, type NpcDef } from '@aozoraquest/core';

let vite: ViteDevServer;
const URL = 'http://127.0.0.1:4271/e2e/fixtures/admin-npc-placement.html';
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:npcadmin'), 'import.meta.env.VITE_EDGE_URL': JSON.stringify('/npc-fixture-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid') },
    server: { host: '127.0.0.1', port: 4271, strictPort: true },
  }); await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

async function tapCell(page: Page, x: number, y: number) {
  const cell = page.locator(`[data-cell="${x},${y}"]`);
  await cell.tap();
}
async function position(page: Page) { return page.getByText('現在の配置:', { exact: false }).innerText(); }

test('390px actual AdminNpcs: draft placement, gestures, saves, recovery, presets and game appearance', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); page.setDefaultTimeout(8_000);
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const town = worldOverlay().spawn;
  const village = starterTownInterior(town);
  const tiles = new Uint8Array(1024 ** 2); tiles[10 * 1024 + 12] = 4;
  const art = emptyTileArt(); art.palette.push('#e020c0'); art.pixels.fill(1);
  const initial: NpcDef[] = [{ id: 'one', name: 'ひとは', x: 10, y: 10, lines: ['やあ'] }, { id: 'two', name: 'ふたりめ', x: 11, y: 11, lines: ['やあ'] }, ...starterTownNpcs()];
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.map': { size: 1024, gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64'), parts: BASE_PARTS },
    'app.aozoraquest.world.npcs': { npcs: initial },
    'app.aozoraquest.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates: starterTownGates(town) },
    'app.aozoraquest.world.tileArt': { arts: { 'npc:one': encodeTileArt(art) } },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  const puts: string[] = []; let failSave = false, failRead = false;
  let releaseSave: (() => void) | null = null;
  await page.route('**/*', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname === '/npc-fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        if (failRead) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
        const record = records[params.collection];
        await route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'isolated-cid' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') {
        puts.push(params.collection);
        if (failSave) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        records[params.collection] = params.record;
        await route.fulfill({ json: { uri: 'at://isolated/record' } });
      } else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (url.pathname.startsWith('/npc-fixture-api/')) {
      if (url.pathname.endsWith('/me/state')) {
        await route.fulfill({ json: { initialized: false, state: { did: 'did:plc:npcadmin', power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 14, y: 22, mapId: village.id, xpEpoch: 1, version: 1, updatedAt: '', flags: ['futaba_arrived'] } } });
      } else await route.fulfill({ status: 503, json: { error: 'NoGameWrites' } });
      return;
    }
    await route.continue();
  });
  try {
    await page.goto(URL);
    await page.getByRole('button', { name: 'ひとは (10,10)', exact: false }).click();
    await expect(page.getByRole('application')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.getByRole('group', { name: '標準の絵' }).getByRole('button')).toHaveCount(8);
    await page.locator('.npc-presets').screenshot({ path: 'test-results/npc-presets-eight.png' });
    await page.getByLabel('地図の広さ').selectOption('13');
    expect((await page.locator('[data-cell]').first().boundingBox())!.width).toBeGreaterThanOrEqual(24);
    await page.getByLabel('地図の広さ').selectOption('9');
    // Hit both sides of the rendered boundary, not just cell centers.
    const boundaryCell = page.locator('[data-cell="7,7"]');
    await boundaryCell.scrollIntoViewIfNeeded();
    const boundary = await boundaryCell.evaluate((el) => { const m = (el as SVGGraphicsElement).getScreenCTM()!; const a = new DOMPoint(32, 16).matrixTransform(m); return { x: a.x, y: a.y }; });
    for (const [dx, expected] of [[-1, '(7, 7)'], [1, '(8, 7)']] as const) {
      await page.touchscreen.tap(boundary.x + dx, boundary.y);
      expect(await position(page)).toContain(expected);
    }
    await page.getByRole('button', { name: '位置を戻す', exact: true }).click();
    const before = await position(page);
    const map = page.getByRole('application'); await map.scrollIntoViewIfNeeded();
    const b = (await map.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const touchX = b.x + b.width / 2, touchY = b.y + b.height * .75;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchX, y: touchY }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchX, y: touchY - i * 24 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => page.evaluate(() => window.scrollY)).not.toBe(scrollBefore);
    expect(await position(page)).toBe(before);
    await map.scrollIntoViewIfNeeded();
    // Long drag and cancellation never move the NPC. Simulate pointer events, not a substitute editor.
    for (const end of ['pointerup', 'pointercancel']) {
      await map.dispatchEvent('pointerdown', { pointerId: 21, isPrimary: true, button: 0, clientX: b.x + 45, clientY: b.y + 45 });
      await map.dispatchEvent('pointermove', { pointerId: 21, isPrimary: true, clientX: b.x + 100, clientY: b.y + 90 });
      await map.dispatchEvent(end, { pointerId: 21, isPrimary: true, clientX: b.x + 100, clientY: b.y + 90 });
    }
    await map.dispatchEvent('pointerdown', { pointerId: 22, isPrimary: true, button: 0, clientX: b.x + 45, clientY: b.y + 45 });
    await map.dispatchEvent('pointerdown', { pointerId: 23, isPrimary: false, button: 0, clientX: b.x + 55, clientY: b.y + 45 });
    await map.dispatchEvent('pointerup', { pointerId: 22, isPrimary: true, clientX: b.x + 45, clientY: b.y + 45 });
    expect(await position(page)).toBe(before);
    await tapCell(page, 12, 10); await expect(page.getByText('壁・水などで歩けないマスには置けません', { exact: true })).toBeVisible();
    await tapCell(page, 11, 11); await expect(page.getByText('「ふたりめ」がいます', { exact: true })).toBeVisible();
    expect(await position(page)).toBe(before);
    await tapCell(page, 11, 10); expect(await position(page)).toContain('(11, 10)'); expect(puts).toEqual([]);
    await expect.poll(async () => page.evaluate(() => (window as unknown as { npcFixture: { savedNpcs: () => NpcDef[] } }).npcFixture.savedNpcs()[0]!.x)).toBe(10);
    await page.getByRole('button', { name: '男の子', exact: false }).click();
    await expect(page.locator('.npc-presets button[aria-pressed=true]')).toContainText('未保存');
    await map.scrollIntoViewIfNeeded(); await map.screenshot({ path: 'test-results/npc-field-placement.png' });
    failSave = true;
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByText(/保存できなかった/)).toBeVisible(); expect(await position(page)).toContain('(11, 10)');
    expect(await page.evaluate(() => (window as unknown as { npcFixture: { savedNpcs: () => NpcDef[] } }).npcFixture.savedNpcs()[0]!.x)).toBe(10);
    failSave = false;
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
    const frozenMap = await map.innerHTML();
    const frozenNote = await page.locator('.npc-map-status').innerText();
    await map.dispatchEvent('keydown', { key: 'ArrowRight' }); await map.dispatchEvent('keydown', { key: 'Enter' });
    await tapCell(page, 10, 9);
    expect(await map.innerHTML()).toBe(frozenMap);
    expect(await page.locator('.npc-map-status').innerText()).toBe(frozenNote);
    expect(await position(page)).toContain('(11, 10)');
    await expect.poll(() => !!releaseSave).toBe(true); releaseSave!(); releaseSave = null;
    await expect(page.getByText(/人を保存した/)).toBeVisible();
    expect(puts.every((p) => p === 'app.aozoraquest.world.npcs')).toBe(true);
    await page.reload(); await page.getByRole('button', { name: 'ひとは (11,10)', exact: false }).click();
    await expect(page.locator('.npc-presets button[aria-pressed=true]')).toContainText('使用中');
    // Selecting another map is browsing only, then a valid cell changes all position fields together.
    await page.getByLabel('マップ', { exact: true }).selectOption(village.id);
    expect(await position(page)).toContain('フィールド');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '移動先選びをやめる' }).click();
    await expect(page.getByLabel('マップ', { exact: true })).toHaveValue('world');
    await page.getByLabel('マップ', { exact: true }).selectOption(village.id);
    await tapCell(page, 16, 16); expect(await position(page)).toContain('ふたば');
    await page.getByRole('application').screenshot({ path: 'test-results/npc-interior-placement.png' });
    await page.locator('.npc-placement').screenshot({ path: 'test-results/npc-mobile-editor.png' });
    await page.getByRole('button', { name: '下へ', exact: true }).scrollIntoViewIfNeeded();
    const controlsBox = (await page.getByRole('button', { name: '下へ', exact: true }).boundingBox())!;
    const footerBox = (await page.locator('.footer-nav').boundingBox())!;
    expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(footerBox.y);
    await page.screenshot({ path: 'test-results/npc-mobile-app-shell.png' });
    await page.getByRole('button', { name: '位置を戻す', exact: true }).click(); expect(await position(page)).toContain('フィールド');
    await page.getByRole('button', { name: '全体図', exact: true }).click();
    const beforeOverview = await position(page);
    await page.getByLabel('全体図で表示領域を選ぶ').tap({ position: { x: 128, y: 128 } });
    expect(await position(page)).toBe(beforeOverview);
    // Explicit mode restores custom art without a tile-art or world-map write.
    await page.getByRole('button', { name: '手描きの絵を使う', exact: true }).click();
    await expect(page.locator('.npc-presets button[aria-pressed=true]')).toHaveCount(0);
    await page.getByRole('button', { name: 'NPCの位置へ' }).click();
    await expect(page.locator('[data-cell="11,10"] rect[fill="#e020c0"]')).toHaveCount(16);
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: '未保存の変更を取り消す' }).click();
    await expect(page.locator('.npc-presets button[aria-pressed=true]')).toHaveCount(1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.locator('.npc-presets .npc-frame-0').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Observe real elapsed time (not a mocked clock): every card alternates equal
    // walking poses without translating its head/cell or leaving a blank frame.
    const gait = await page.locator('.npc-presets .npc-sprite').evaluateAll(async (sprites) => {
      const samples: { time: number; poses: number[]; stationary: boolean }[] = [];
      const start = performance.now();
      while (performance.now() - start < 1350) {
        await new Promise(requestAnimationFrame);
        samples.push({ time: performance.now() - start, poses: sprites.map((sprite) => {
          const visible = [...sprite.children].map((frame) => getComputedStyle(frame).visibility === 'visible');
          return visible[0] === visible[1] ? -1 : visible[0] ? 0 : 1;
        }), stationary: sprites.every((sprite) => [sprite, ...sprite.children].every((el) => getComputedStyle(el).transform === 'none')) });
      }
      return samples;
    });
    expect(gait.every((s) => s.stationary && s.poses.length === 8 && s.poses.every((p) => p >= 0))).toBe(true);
    for (let i = 0; i < 8; i++) {
      const changes = gait.filter((s, n) => n > 0 && s.poses[i] !== gait[n - 1]!.poses[i]);
      expect(changes.length).toBeGreaterThanOrEqual(3);
      for (let n = 1; n < changes.length; n++) {
        expect(changes[n]!.time - changes[n - 1]!.time).toBeGreaterThan(240);
        expect(changes[n]!.time - changes[n - 1]!.time).toBeLessThan(360);
      }
    }
    await page.getByLabel('マップ', { exact: true }).selectOption(village.id);
    await tapCell(page, 16, 16);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => !!releaseSave).toBe(true); releaseSave!(); releaseSave = null;
    await expect(page.getByText(/人を保存した/)).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /ひとは.*16,16/ }).click();
    expect(await position(page)).toContain('ふたば'); expect(await position(page)).toContain('(16, 16)');
    failRead = true; await page.reload(); await expect(page.getByRole('button', { name: '再試行' })).toBeVisible(); await expect(page.getByRole('application')).toHaveCount(0);
    failRead = false; await page.getByRole('button', { name: '再試行' }).click(); await expect(page.getByRole('button', { name: '＋NPC', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /ひとは.*16,16/ }).click();
    await page.getByRole('button', { name: '手描きの絵を使う', exact: true }).click();
    await page.getByRole('button', { name: '絵をかく', exact: true }).click();
    await page.locator('input[type="color"]').fill('#00aaff');
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await expect.poll(() => !!releaseSave).toBe(true); releaseSave!(); releaseSave = null;
    // saveTileArts also writes the existing world map; release its second transport call.
    await expect.poll(() => !!releaseSave).toBe(true); releaseSave!(); releaseSave = null;
    await expect(page.getByText(/地形ぶんを保存した/)).toBeVisible();
    await page.getByRole('button', { name: /ふたりめ.*11,11/ }).click();
    await page.getByRole('button', { name: /ひとは.*16,16/ }).click();
    await expect(page.locator('[data-cell="16,16"] rect[fill="#00aaff"]')).toHaveCount(16);
    // Same sprite component is used by the real World route with a schema-valid saved NPC record.
    const saved = records['app.aozoraquest.world.npcs'] as { npcs: NpcDef[] };
    const elder = saved.npcs.find((n) => n.mapId === village.id)!; elder.spritePreset = 'old-man';
    await page.goto(`${URL}?game`); await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await expect(page.getByLabel('ワールドマップ').locator('[data-preset="old-man"]')).toBeVisible();
    for (let i = 0; i < 8 && await page.locator('.aq-dialogue-backdrop').count(); i++) await page.locator('.aq-dialogue-backdrop').click();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    await expect.poll(async () => page.getByLabel('ワールドマップ').locator('.npc-frame-1').first().evaluate((el) => getComputedStyle(el).visibility), { intervals: [50] }).toBe('visible');
    await page.getByLabel('ワールドマップ').screenshot({ path: 'test-results/npc-game-preset.png' });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
