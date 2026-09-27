import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import {
  starterTownInterior, starterTownGates, starterTownNpcs, starterTownQuests, starterTownScenario, starterTownShop,
  worldOverlay, townShopStock, setInteriors, setNpcs, setGameQuests, setScenario, setShopOverrides, encodeWorldMap,
} from '@aozoraquest/core';
import { handleQuestAccept } from '../../edge/src/game-quest';
import { cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';

const DID = 'did:plc:tutorial';
const ADMIN = 'did:plc:tutorialadmin';
const NOW = 1_700_000_000;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({
    configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'),
      'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify(ADMIN),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    },
    server: { host: '127.0.0.1', port: 4177, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

async function readAll(page: Page) {
  for (let i = 0; i < 8 && await page.locator('.aq-dialogue-backdrop').count(); i++) {
    if (await page.getByRole('button', { name: 'はい', exact: true }).count()) return;
    // 会話イラストつきの窓 (#696) は画面中央を覆うので、送りは画面上端をタップする。
    await page.locator('.aq-dialogue-backdrop').click({ position: { x: 195, y: 8 } });
  }
}

const SHOTS = process.env.OPENING_SHOTS ?? 'test-results/opening-story';

async function captureMapDialogue(page: Page, stage: string) {
  mkdirSync(SHOTS, { recursive: true });
  for (const viewport of [{ width: 320, height: 640 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const map = (await page.getByLabel('ワールドマップ').boundingBox())!;
    const parts = page.locator('.aq-dialogue-pane, img[alt$="の会話イラスト"]');
    const boxes = [];
    for (const part of await parts.all()) {
      const box = (await part.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(map.x);
      expect(box.y).toBeGreaterThanOrEqual(map.y);
      expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height + 1);
      boxes.push({ element: await part.evaluate((el) => el.tagName === 'IMG' ? 'portrait' : el.textContent), ...box });
    }
    const pane = page.locator('.aq-dialogue-pane').last();
    expect(await pane.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    const portrait = page.locator('img[alt$="の会話イラスト"]');
    if (await portrait.count()) {
      expect(await portrait.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
      expect((await portrait.boundingBox())!.height).toBeGreaterThan(80);
    }
    const prefix = `${SHOTS}/${stage}-${viewport.width}`;
    writeFileSync(`${prefix}.json`, JSON.stringify({ viewport, map, boxes }, null, 2));
    await page.screenshot({ path: `${prefix}.png` });
  }
}

test('ふたば: 救護/表情/マップ内表示 → ギルド再会/退出 → 既存直接依頼/旅立ち (#707)', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  // 通常会話の管理画像も実際の許可済み笑顔原本で配る（導入の行別表情とは別経路）。
  const portraitBytes = readFileSync(path.join(process.cwd(), 'src/assets/futaba/bluesky-smile.webp'));
  const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: cidFor(portraitBytes) }, mimeType: 'image/webp' as const, size: portraitBytes.length }, width: 512, height: 768 };
  const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky' ? { ...n, portraitImage } : n), quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const elder = npcs.find((n) => n.id === 'futaba-elder')!;
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  let state: GameState = { did: DID, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x, y: bluesky.y + 1,
    mapId: village.id, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  let cid = 'initial'; let rev = 0;
  const env = await tutorialEnv(NOW);
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('pds.fixture.invalid') && url.includes('getRecord')) return Response.json({ cid, value: state });
    if (url.includes('pds.fixture.invalid') && url.includes('putRecord')) {
      const b = JSON.parse(init.body as string);
      if (b.swapRecord && b.swapRecord !== cid) return Response.json({ error: 'InvalidSwap' }, { status: 400 });
      state = b.record; cid = `r${++rev}`;
      return Response.json({ cid });
    }
    if (url.includes('getRecord') && url.includes('analysis')) return Response.json({ value: diag });
    throw new Error(`External request forbidden in opening story test: ${new URL(url).hostname}`);
  }) as typeof fetch;
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.npcs': { npcs },
    'app.aozoraquest.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.world.quests': { quests }, 'app.aozoraquest.world.scenario': { events: scenario },
    'app.aozoraquest.world.shops': { shops: [shop] }, 'app.aozoraquest.test.analysis': diag,
    // 初回 (はじめから直後): そらのはね未受領 → 導入に続けて Blueskyちゃんが手渡す (#703)。
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: false, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  // リセット (+20 付与) 直後の入場を再現する祝福マーク。初回だけ立てる (リロードで立て直さない)。
  await page.addInitScript(() => {
    if (sessionStorage.getItem('e2e-armed')) return;
    sessionStorage.setItem('e2e-armed', '1');
    sessionStorage.setItem('aq-welcome-blessing-pending', '1');
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        // 実機と同じく管理データの NPC は遅れて届く (#703)。導入はその到着を待って絵を出す。
        if (params.collection === 'app.aozoraquest.world.npcs') await new Promise((r) => setTimeout(r, 1200));
        const record = records[params.collection];
        await route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'fixture-cid' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') { records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://fixture/record' } }); }
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    if (url.pathname === '/fixture-api/api/npc-image') {
      const ok = url.searchParams.get('npcId') === 'futaba-bluesky' && url.searchParams.get('kind') === 'portrait' && url.searchParams.get('cid') === portraitImage.blob.ref.$link;
      await route.fulfill(ok ? { contentType: 'image/webp', body: portraitBytes } : { status: 404, body: 'not found' });
      return;
    }
    const body = route.request().postDataJSON();
    try {
      let result: unknown;
      if (url.pathname.endsWith('/me/state')) result = { state, initialized: false };
      else if (url.pathname.endsWith('/quest/accept')) result = await handleQuestAccept(env, DID, body.questId, NOW);
      else if (url.pathname.endsWith('/move')) result = await handleMove(env, DID, body.dx, body.dy, body.token, NOW);
      else throw new Error(`Unexpected fixture API ${url.pathname}`);
      await route.fulfill({ json: result });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  const window = page.locator('.dq-window').last();
  // 会話イラストつきの窓 (#696) は画面中央を覆うので、送りは画面上端をタップする。
  const next = () => page.locator('.aq-dialogue-pane').last().click();
  const bump = async (key: 'ArrowLeft' | 'ArrowUp') => {
    await page.keyboard.press(key);
    await expect(page.locator('.aq-dialogue-backdrop')).toBeVisible();
  };
  const reenter = async (next: Partial<GameState>) => {
    state = { ...state, ...next };
    await page.reload();
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
  };
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:4177/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    const portrait = page.getByRole('img', { name: 'Blueskyちゃんの会話イラスト' });
    await expect(window).toContainText('……きこえる？ だいじょうぶ？');
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    await expect(portrait).toHaveAttribute('src', /bluesky-worried/);
    await captureMapDialogue(page, 'opening-worried');
    const position = await page.locator('[data-world-x]').getAttribute('data-world-x');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Tab');
    await expect(page.locator('.aq-dialogue-backdrop')).toBeFocused();
    expect(await page.locator('[data-world-x]').getAttribute('data-world-x')).toBe(position);
    await next();
    await expect(window).toContainText('けがしてる……。まって、やくそうが あるから。');
    await next();
    await expect(window).toContainText('少女は やくそうを とりだし');
    await expect(portrait).toHaveCount(0);
    await next();
    await expect(window).toContainText('よかった……！ 気が ついたんだね。');
    await expect(portrait).toHaveAttribute('src', /bluesky-smile/);
    await captureMapDialogue(page, 'opening-smile');
    await next();
    await expect(window).toContainText('村の まえで たおれてたから、しんぱいしたよ。');
    await next();
    await expect(window).toContainText('わたしは Bluesky。この村の 冒険者ギルドで 受付を してるの。');
    await captureMapDialogue(page, 'introduction');
    await next();
    await expect(window).toContainText('これも もっていて。また いたくなったら つかってね。');
    await captureMapDialogue(page, 'handoff');
    await next();
    await expect(window).toContainText('やくそうを うけとった！');
    await next();
    await expect(window).toContainText('そらのはねも あげるね。');
    await next();
    await expect(window).toContainText('そらのはねを うけとった！');
    await next();
    await expect(window).toContainText('村の ギルドで すこし やすんでいかない？');
    await captureMapDialogue(page, 'invitation');
    await next();
    await expect(window).toContainText('【はじまりの祝福】');
    await next();
    await expect(window).toContainText('【操作ガイド】マップを');
    await expect(portrait).toHaveCount(0);
    await captureMapDialogue(page, 'guide');
    await next();
    await expect(window).toContainText('【操作ガイド】じぶんを');
    await next();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    await expect(page.getByText('はじまりの祝福', { exact: true })).toBeVisible();
    await expect(page.getByText('はじまりの祝福', { exact: true })).toHaveCount(0, { timeout: 5_000 });
    // 建物の入口→初回再会→既存物語→退出。位置は権威ドア前のまま。
    await page.screenshot({ path: `${SHOTS}/guild-door-390.png` });
    await bump('ArrowUp');
    await expect(window).toContainText('来てくれたんだね。');
    await expect(portrait).toHaveAttribute('src', /npc-image/); // 通常会話は管理画像を優先
    await captureMapDialogue(page, 'guild-reunion');
    await next();
    await expect(window).toContainText('ここが 村の 冒険者ギルド');
    await next();
    await expect(window).toContainText('おにいちゃんが、いなくなっちゃったの。');
    await readAll(page);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.up('ArrowUp');
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    await expect(page.locator('[data-world-x]')).toHaveAttribute('data-world-x', String(bluesky.x));
    await expect(page.locator('[data-world-y]')).toHaveAttribute('data-world-y', String(bluesky.y + 1));
    const moved = page.waitForResponse((r) => r.url().endsWith('/move'));
    await page.keyboard.press('ArrowDown');
    const moveResponse = await moved;
    expect(moveResponse.status(), await moveResponse.text()).toBe(200);
    await expect(page.locator('[data-world-y]')).toHaveAttribute('data-world-y', String(bluesky.y + 2));
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[data-world-y]')).toHaveAttribute('data-world-y', String(bluesky.y + 1));
    await bump('ArrowUp');
    await expect(window).toContainText('おかえり。');
    await readAll(page);
    // ③ むらおさの最初の依頼は七羽の鳥の伝承から始まる。
    await reenter({ x: elder.x, y: elder.y + 1 });
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0); // 既読なので①は出ない
    await bump('ArrowUp');
    await expect(page.getByRole('dialog', { name: 'むらおさのセリフ' })).toBeVisible();
    await expect(window).toContainText('むかし、空は七羽の鳥に守られておった。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-elder-legend.png` });
    await next();
    await expect(window).toContainText('まずは 村を たすけて 旅の力を つけておくれ。');
    await readAll(page);
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    await expect.poll(() => state.quest?.id).toBe('futaba-slimes');
    // ⑤ 3 依頼を終えた状態 (実報告は tutorial.spec が担う) で、Blueskyちゃんが旅立ちを示す。
    await reenter({ x: bluesky.x, y: bluesky.y + 1, quest: undefined,
      questsDone: ['futaba-slimes', 'futaba-herbs', 'futaba-wings'], flags: ['futaba_slimes_done', 'futaba_herbs_done', 'futaba_wings_done'] });
    await bump('ArrowUp');
    await expect(window).toContainText('おかえり。');
    await next();
    await expect(window).toContainText('砂漠の方で、夜になると赤い光が見えるんだって。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-departure-hint.png` });
    await next();
    await expect(window).toContainText('ほむらの街');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-departure-homura.png` });
    await readAll(page);
    expect(errors).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null);
  }
});
