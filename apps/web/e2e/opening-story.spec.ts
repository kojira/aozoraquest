import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import {
  starterTownInterior, starterTownGates, starterTownNpcs, starterTownQuests, starterTownScenario, starterTownShop,
  worldOverlay, townShopStock, setInteriors, setNpcs, setGameQuests, setScenario, setShopOverrides, encodeWorldMap,
} from '@aozoraquest/core';
import { handleQuestAccept } from '../../edge/src/game-quest';
import { imageFixture, cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
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

test('ふたばの村の導入: 倒れていた放浪者 → 駆け寄る Blueskyちゃん → 伝承つきの依頼 → 旅立ちの案内 (#692, #696)', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(8_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  // 管理データで Blueskyちゃんに会話イラストを保存した状態 (#696)。画像は fixture から配る (同梱しない)。
  // CIの単色画像は機能回帰用。視覚QCは指定された実心配顔webpを渡して行う。
  const realPortrait = process.env.OPENING_PORTRAIT;
  const portraitBytes = realPortrait ? readFileSync(realPortrait) : imageFixture('300x450.png');
  const mimeType = realPortrait ? 'image/webp' as const : 'image/png' as const;
  const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: cidFor(portraitBytes) }, mimeType, size: portraitBytes.length }, width: realPortrait ? 512 : 300, height: realPortrait ? 768 : 450 };
  let failPortrait = false;
  const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky' ? { ...n, portraitImage } : n), quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const elder = npcs.find((n) => n.id === 'futaba-elder')!;
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  let state: GameState = { did: DID, power: 20, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: town.x, y: town.y + 1,
    xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
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
    'app.aozoraquest.test.world': { x: town.x, y: town.y + 1, gotStarterFeather: false, regions: [town.region], visitedTowns: [], hp: null, mp: null },
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
      const ok = !failPortrait && url.searchParams.get('npcId') === 'futaba-bluesky' && url.searchParams.get('kind') === 'portrait' && url.searchParams.get('cid') === portraitImage.blob.ref.$link;
      await route.fulfill(ok ? { contentType: mimeType, body: portraitBytes } : { status: 404, body: 'not found' });
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
  // マップ内の台詞面そのものを押して送る (全面送り面だけの動作確認にしない)。
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
    // ① 初回: 地の文→心配→安心→自己紹介→村案内。操作説明は手渡し後。
    const portrait = page.getByRole('img', { name: 'Blueskyちゃんの会話イラスト' });
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toBeVisible();
    await expect(window).toContainText('……きがつくと、しらない 村の まえに たおれていた。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await expect(portrait).toHaveCount(0); // 地の文ではまだ駆け寄っていない
    await page.screenshot({ path: `${SHOTS}/01-onboarding-narration.png` });
    await next();
    await expect(window).toContainText('そらは はいいろ。ここは どこだろう……');
    await next();
    await expect(page.getByRole('dialog', { name: 'Blueskyちゃんのセリフ' })).toBeVisible();
    await expect(window).toContainText('だいじょうぶ？ 村の まえで たおれてたんだよ。');
    await expect(portrait).toBeVisible();
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(portraitImage.width);
    await captureMapDialogue(page, 'opening');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01b-onboarding-bluesky.png` });
    await next();
    await expect(window).toContainText('あ、目が さめたんだね。よかった……！');
    await next();
    await expect(window).toContainText('わたしは Blueskyちゃん。この村に すんでるの。');
    await next();
    await expect(window).toContainText('まだ ふらふら するよね。村で すこし やすもう。');
    await captureMapDialogue(page, 'village-invitation');
    await expect(page.getByRole('dialog', { name: 'ブルスコンのセリフ' })).toHaveCount(0);
    await next();
    // 同じ人物が気遣って手渡す。システム通知・ガイドには話者も立ち絵も付けない。
    await expect(window).toContainText('むりは しないでね。これ、もっていて。やくそう と そらのはね だよ。');
    await captureMapDialogue(page, 'handoff');
    await expect(page.getByRole('dialog', { name: 'Blueskyちゃんのセリフ' })).toBeVisible();
    await expect(portrait).toBeVisible();
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01d-starter-handoff.png` });
    await next();
    await expect(window).toContainText('やくそうは きずを なおせるよ。つらいときは がまん しないで つかってね。');
    await next();
    await expect(window).toContainText('そらのはねが あれば、いったことの ある街へ もどれるの。');
    await captureMapDialogue(page, 'feather');
    await next();
    await expect(window).toContainText('わたしも 村に もどるね。いどのそばで まってるよ。ゆっくり おいで。');
    await next();
    await expect(window).toContainText('やくそう と そらのはねを うけとった！');
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toBeVisible();
    await expect(portrait).toHaveCount(0);
    await next();
    await expect(window).toContainText('【はじまりの祝福】あおぞらパワーが 20 ふえた！');
    await expect(portrait).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/01e-starter-blessing.png` });
    await next();
    await expect(window).toContainText('【操作ガイド】マップを おしたまま 指を うごかすと 移動。');
    await expect(portrait).toHaveCount(0);
    await captureMapDialogue(page, 'guide');
    await next();
    await expect(window).toContainText('【操作ガイド】じぶんを タップすると コマンド。');
    await next();
    await expect(page.getByText('はじまりの祝福')).toBeVisible();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    await expect(page.getByText('はじまりの祝福')).toHaveCount(0, { timeout: 5_000 });
    expect(state.power).toBe(20); // 表示を読む操作で追加付与しない
    expect(records['app.aozoraquest.test.world']).toMatchObject({ gotStarterFeather: true });
    // 会話イラストが読めなくても、画像なしで導入は最後まで進む。
    failPortrait = true;
    await page.evaluate(() => localStorage.removeItem('aq-world-onboarding-done'));
    await page.reload();
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await next();
    await next();
    await expect(window).toContainText('だいじょうぶ？ 村の まえで たおれてたんだよ。');
    await expect(portrait).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/01c-onboarding-bluesky-no-portrait.png` });
    for (let i = 0; i < 4; i++) await next();
    await expect(window).toContainText('【操作ガイド】マップを おしたまま 指を うごかすと 移動。');
    await next();
    await expect(window).toContainText('【操作ガイド】じぶんを タップすると コマンド。');
    await next();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    failPortrait = false;
    // ② 井戸のそばの Blueskyちゃん (右隣から話しかける)。
    await reenter({ x: bluesky.x + 1, y: bluesky.y, mapId: village.id });
    await bump('ArrowLeft');
    await expect(page.getByRole('dialog', { name: 'Blueskyちゃんのセリフ' })).toBeVisible();
    await expect(window).toContainText('おにいちゃんが、いなくなっちゃったの。そしたら、空の色も……');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await expect(portrait).toBeVisible();
    await captureMapDialogue(page, 'normal-npc');
    await page.screenshot({ path: `${SHOTS}/02-bluesky-chan.png` });
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
    await captureMapDialogue(page, 'quest-choices');
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    await expect.poll(() => state.quest?.id).toBe('futaba-slimes');
    // ⑤ 3 依頼を終えた状態 (実報告は tutorial.spec が担う) で、Blueskyちゃんが旅立ちを示す。
    await reenter({ x: bluesky.x + 1, y: bluesky.y, quest: undefined,
      questsDone: ['futaba-slimes', 'futaba-herbs', 'futaba-wings'], flags: ['futaba_slimes_done', 'futaba_herbs_done', 'futaba_wings_done'] });
    await bump('ArrowLeft');
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
