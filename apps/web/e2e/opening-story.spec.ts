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
import { handleQuestAccept, handleQuestComplete } from '../../edge/src/game-quest';
import { cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
import { applyBattleOutcome } from '../../edge/src/battle-reward';
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
  for (let i = 0; i < 16 && await page.locator('.aq-dialogue-backdrop').count(); i++) {
    if (await page.locator('.aq-dialogue-pane button').count()) return;
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
    const parts = page.locator('.aq-dialogue-pane, .aq-dialogue-pane button, img[alt$="の会話イラスト"]');
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

async function captureQuestChoices(page: Page, stage: string) {
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const map = (await page.getByLabel('ワールドマップ').boundingBox())!;
    const pane = page.locator('.aq-dialogue-pane').last();
    const box = (await pane.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(map.x);
    expect(box.y).toBeGreaterThanOrEqual(map.y);
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height + 1);
    expect(await pane.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const button of await pane.getByRole('button').all()) {
      await button.scrollIntoViewIfNeeded();
      const b = (await button.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.y).toBeGreaterThanOrEqual(box.y);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    await pane.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `${SHOTS}/${stage}-${width}.png` });
  }
}

async function captureQuestMenu(page: Page, stage: string) {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const map = (await page.getByLabel('ワールドマップ').boundingBox())!;
    const menu = page.getByRole('dialog', { name: 'コマンド' });
    for (const part of [menu.locator('section'), ...await menu.getByRole('button').all()]) {
      const b = (await part.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(map.x);
      expect(b.y).toBeGreaterThanOrEqual(map.y);
      expect(b.x + b.width).toBeLessThanOrEqual(map.x + map.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(map.y + map.height + 1);
    }
    await expect(menu).toContainText('所持品は ほかの依頼');
    await menu.locator('section').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.screenshot({ path: `${SHOTS}/${stage}-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

test('ふたば: 救護/表情/マップ内表示 → ギルド再会/退出 → 既存直接依頼/旅立ち (#707)', async ({ page }) => {
  test.setTimeout(180_000);
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
  let state: GameState = { did: DID, activeQuests: [], power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x, y: bluesky.y + 1,
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
  const reported: string[] = [];
  let failAcceptId: string | undefined;
  let reportResponseGate: Promise<void> | undefined;
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
      else if (url.pathname.endsWith('/quest/accept')) {
        if (body.questId === failAcceptId) { failAcceptId = undefined; await route.abort(); return; }
        result = await handleQuestAccept(env, DID, body.questId, NOW);
      }
      else if (url.pathname.endsWith('/quest/complete')) {
        reported.push(body.questId);
        result = await handleQuestComplete(env, DID, body.questId, NOW);
        await reportResponseGate;
      }
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
    // 建物の入口→初回再会→4メニュー→詳細/取消/受注/納品。位置は権威ドア前のまま。
    await page.screenshot({ path: `${SHOTS}/guild-door-390.png` });
    await bump('ArrowUp');
    await expect(window).toContainText('来てくれたんだね。');
    await expect(portrait).toHaveAttribute('src', /npc-image/); // 通常会話は管理画像を優先
    await captureMapDialogue(page, 'guild-reunion');
    await next();
    await expect(window).toContainText('ここが 村の 冒険者ギルド');
    await next();
    const choose = (name: string) => page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name: '依頼を見る', exact: true })).toBeVisible();
    await captureMapDialogue(page, 'guild-menu');
    await choose('依頼を見る');
    await expect(window).toContainText('道具の手入れに');
    await next();
    await expect(window).toContainText('村の道具屋');
    await next(); await next();
    await expect(window).toContainText('2こ わたします');
    await captureMapDialogue(page, 'guild-consumption');
    await readAll(page);
    await captureMapDialogue(page, 'guild-accept');
    await choose('やめておく');
    expect(state.activeQuests).toEqual([]);
    await choose('報告する');
    await expect(window).toContainText('いま 報告できる 受注中の依頼は ない');
    await readAll(page);
    await choose('依頼を見る'); await readAll(page);
    await choose('受注する');
    await expect(window).toContainText('うけおった');
    expect(state.activeQuests[0]?.id).toBe('futaba-tool-care');
    await readAll(page);
    await choose('やめる');
    await reenter({ x: elder.x, y: elder.y + 1 });
    await bump('ArrowUp'); await readAll(page); await choose('はい');
    await expect.poll(() => state.activeQuests.length).toBe(2);
    state = { ...state, power: 3 };
    for (let i = 0; i < 3; i++) state = applyBattleOutcome(state, {
      outcome: 'win', monsterId: 'sky-slime', archetype: 'warrior', luk: 0, rewardSeed: 1, lossSeed: 2, rewarded: true,
    }).next;
    // Clear only fixture drops to exercise insufficient inventory; no shared PDS is involved.
    await reenter({ x: bluesky.x, y: bluesky.y + 1, materials: {} });
    expect(state.activeQuests.find(q => q.id === 'futaba-slimes')?.progress).toBe(3);
    const map = (await page.getByLabel('ワールドマップ').boundingBox())!;
    await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2);
    await expect(page.getByRole('dialog', { name: 'コマンド' })).toContainText('受注中の依頼 2件');
    await expect(page.getByRole('dialog', { name: 'コマンド' })).toContainText('報告できます');
    await captureQuestMenu(page, 'parallel-quests');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await bump('ArrowUp');

    await choose('依頼を見る'); await readAll(page);
    await choose('報告する'); await readAll(page); await choose('報告する');
    await expect(window).toContainText('スライムのしずくを 2こ');
    await next();
    await expect(window).toContainText('まだ 0/2 こ');
    await readAll(page);
    expect(state.materials['slime-drop'] ?? 0).toBe(0);
    expect(state.power).toBe(0);
    await choose('話す');
    await expect(window).toContainText('おにいちゃんが、いなくなっちゃったの。');
    await readAll(page);
    await choose('やめる');
    // 隔離PDSで素材入手後を再現する。実環境の戦闘/ドロップの受入ではない。
    await reenter({ materials: { ...state.materials, 'slime-drop': 2 } });
    await bump('ArrowUp');
    await choose('依頼を見る');
    for (let i = 0; i < 12 && !(await window.innerText()).includes('(2/2)'); i++) await next();
    await expect(window).toContainText('(2/2)');
    await captureMapDialogue(page, 'guild-progress');
    await readAll(page);
    const powerBefore = state.power;
    const herbsBefore = state.materials.herb ?? 0;
    await choose('報告する'); await readAll(page); await choose('報告する');
    await expect(window).toContainText('2こ うけとった');
    await next();
    await expect(window).toContainText('やくそう ×2 と あおぞらパワー 5');
    await captureMapDialogue(page, 'guild-completed');
    expect(state.materials['slime-drop'] ?? 0).toBe(0);
    expect(state.materials.herb).toBe(herbsBefore + 2);
    expect(state.power).toBe(powerBefore + 5);
    expect(state.activeQuests).toEqual([{ id: 'futaba-slimes', progress: 3 }]);
    expect(state.flags ?? []).not.toContain('futaba_slimes_done');
    await readAll(page);
    const completed = structuredClone(state);
    await choose('報告する');
    await expect(window).toContainText('いま 報告できる 受注中の依頼は ない');
    await readAll(page);
    await choose('依頼を見る');
    for (let i = 0; i < 12 && !(await window.innerText()).includes('達成済み'); i++) await next();
    await expect(window).toContainText('達成済み');
    expect(state).toEqual(completed);
    await readAll(page);
    await choose('やめる');
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
    await choose('やめる');
    // shared-data override: 新依頼を削除した管理レコードを同梱で復活させない。
    records['app.aozoraquest.world.quests'] = { quests: quests.filter(q => q.id !== 'futaba-tool-care') };
    await reenter({ x: bluesky.x, y: bluesky.y + 1 });
    await bump('ArrowUp'); await choose('依頼を見る');
    await expect(window).toContainText('いま 紹介できる 依頼は ない');
    await readAll(page); await choose('やめる');
    records['app.aozoraquest.world.quests'] = { quests };
    // Reload restores the other active quest; reporting it still advances the existing story.
    await reenter({ x: elder.x, y: elder.y + 1 });
    await bump('ArrowUp');
    await expect.poll(() => state.questsDone?.includes('futaba-slimes')).toBe(true);
    await readAll(page);
    expect(state.questsDone).toContain('futaba-tool-care');
    expect(state.activeQuests).toEqual([]);
    expect(state.flags).toContain('futaba_slimes_done');
    // ⑤ 3 依頼を終えた状態 (実報告は tutorial.spec が担う) で、Blueskyちゃんが旅立ちを示す。
    await reenter({ x: bluesky.x, y: bluesky.y + 1, activeQuests: [],
      questsDone: ['futaba-slimes', 'futaba-herbs', 'futaba-wings'], flags: ['futaba_slimes_done', 'futaba_herbs_done', 'futaba_wings_done'] });
    await bump('ArrowUp');
    await expect(window).toContainText('おかえり。');
    await choose('話す');
    await expect(window).toContainText('砂漠の方で、夜になると赤い光が見えるんだって。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-departure-hint.png` });
    await next();
    await expect(window).toContainText('ほむらの街');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-departure-homura.png` });
    await readAll(page);
    await choose('やめる');
    // Isolated authoring fixtures: same NPC, same title and objective, distinct IDs/rewards.
    // Shared record loading uses the production validator on both client and edge.
    const guildBase = quests.find(q => q.id === 'futaba-tool-care')!;
    const multi = ['fixture-a', 'fixture-b', 'fixture-c', 'fixture-d'].map((id, i) => ({ ...guildBase, id, reward: { power: i + 1 } }));
    setGameQuests(multi); records['app.aozoraquest.world.quests'] = { quests: multi };
    await reenter({ x: bluesky.x, y: bluesky.y + 1, questsDone: [], activeQuests: multi.map(q => ({ id: q.id, progress: 0 })), materials: { 'slime-drop': 2 }, power: 10 });
    await bump('ArrowUp'); await choose('報告する');
    const beforeReports = reported.length;
    await captureQuestChoices(page, 'guild-identical-choices');
    await choose('次へ');
    await expect(page.getByRole('button', { name: /fixture-d/ })).toBeVisible();
    await choose('前へ');
    await page.getByRole('button', { name: /fixture-b/ }).click();
    await readAll(page); await choose('報告する');
    await expect.poll(() => state.questsDone).toEqual(['fixture-b']);
    expect(reported.slice(beforeReports)).toEqual(['fixture-b']);
    expect(state.power).toBe(12);
    expect(state.materials['slime-drop'] ?? 0).toBe(0);
    expect(state.activeQuests.map(q => q.id)).toEqual(['fixture-a', 'fixture-c', 'fixture-d']);
    await readAll(page); await choose('報告する');
    await expect(page.getByRole('button', { name: /fixture-a/ })).toContainText('(0/2)');
    await choose('戻る'); await choose('やめる');

    const direct = multi.map(q => ({ ...q, npcId: elder.id }));
    setGameQuests(direct); records['app.aozoraquest.world.quests'] = { quests: direct };
    await reenter({ x: elder.x, y: elder.y + 1, questsDone: [], activeQuests: [{ id: 'fixture-a', progress: 0 }], materials: { 'slime-drop': 2 } });
    await bump('ArrowUp');
    const directBefore = reported.length;
    await captureQuestChoices(page, 'direct-identical-choices');
    expect(reported.length).toBe(directBefore); // Multiple candidates never auto-report the first.
    await page.getByRole('button', { name: /fixture-b/ }).click(); await readAll(page);
    failAcceptId = 'fixture-b';
    await choose('はい');
    await expect(window).toContainText('通信に失敗しました');
    await readAll(page);
    await expect(page.getByRole('button', { name: 'はい', exact: true })).toBeVisible();
    expect(state.activeQuests).toEqual([{ id: 'fixture-a', progress: 0 }]);
    await choose('はい');
    await expect.poll(() => state.activeQuests.map(q => q.id)).toEqual(['fixture-a', 'fixture-b']);
    // Hold the selected report response until the real dialogue's input shield is checked.
    let releaseReportResponse!: () => void;
    reportResponseGate = new Promise<void>(resolve => { releaseReportResponse = resolve; });
    const reportResponse = page.waitForResponse(r => r.url().endsWith('/quest/complete'));
    try {
      await page.getByRole('button', { name: /fixture-b/ }).click();
      await expect.poll(() => reported.slice(directBefore)).toEqual(['fixture-b']);
      await expect.soft(page.locator('.aq-dialogue-backdrop')).toBeVisible({ timeout: 2_000 });
      const pendingMap = (await page.getByLabel('ワールドマップ').boundingBox())!;
      await page.mouse.click(pendingMap.x + pendingMap.width / 2, pendingMap.y + pendingMap.height / 2);
      await expect.soft(page.getByRole('dialog', { name: 'コマンド' })).toHaveCount(0, { timeout: 2_000 });
      await expect(page.locator('.aq-dialogue-backdrop')).toBeVisible({ timeout: 2_000 });
    } finally {
      releaseReportResponse();
      reportResponseGate = undefined;
    }
    await reportResponse;
    await expect(window).toContainText('2こ うけとった');
    await expect.poll(() => state.questsDone).toEqual(['fixture-b']);
    expect(reported.slice(directBefore)).toEqual(['fixture-b']);
    expect(state.activeQuests).toEqual([{ id: 'fixture-a', progress: 0 }]);
    await readAll(page); await choose('戻る');
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null);
  }
});
