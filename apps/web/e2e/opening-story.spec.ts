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
    await page.locator('.aq-dialogue-backdrop').click();
  }
}

const SHOTS = process.env.OPENING_SHOTS ?? 'test-results/opening-story';

test('ふたばの村の導入: 倒れていた放浪者 → Blueskyちゃん → 伝承つきの依頼 → 旅立ちの案内 (#692)', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(8_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const npcs = starterTownNpcs(), quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const elder = npcs.find((n) => n.id === 'futaba-elder')!;
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  let state: GameState = { did: DID, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x + 1, y: bluesky.y,
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
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') {
        const record = records[params.collection];
        await route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'fixture-cid' } : { error: 'RecordNotFound' } });
      } else if (op === 'put') { records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://fixture/record' } }); }
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
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
    // ① 初回: 話者なしの地の文から始まり、ブルスコンの操作説明、村へ入る案内で終わる。
    await expect(page.getByRole('dialog', { name: 'セリフ', exact: true })).toBeVisible();
    await expect(window).toContainText('……きがつくと、しらない 村の まえに たおれていた。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-onboarding-narration.png` });
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(window).toContainText('そらは はいいろ。ここは どこだろう……');
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(page.getByRole('dialog', { name: 'ブルスコンのセリフ' })).toBeVisible();
    await page.locator('.aq-dialogue-backdrop').click();
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(window).toContainText('村に はいって、いどのそばの むらおさに');
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    // ② 井戸のそばの Blueskyちゃん (右隣から話しかける)。
    await bump('ArrowLeft');
    await expect(page.getByRole('dialog', { name: 'Blueskyちゃんのセリフ' })).toBeVisible();
    await expect(window).toContainText('おにいちゃんが、いなくなっちゃったの。そしたら、空の色も……');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
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
    await page.locator('.aq-dialogue-backdrop').click();
    await expect(window).toContainText('まずは 村を たすけて 旅の力を つけておくれ。');
    await readAll(page);
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    await expect.poll(() => state.quest?.id).toBe('futaba-slimes');
    // ⑤ 3 依頼を終えた状態 (実報告は tutorial.spec が担う) で、Blueskyちゃんが旅立ちを示す。
    await reenter({ x: bluesky.x + 1, y: bluesky.y, quest: undefined,
      questsDone: ['futaba-slimes', 'futaba-herbs', 'futaba-wings'], flags: ['futaba_slimes_done', 'futaba_herbs_done', 'futaba_wings_done'] });
    await bump('ArrowLeft');
    await expect(window).toContainText('砂漠の方で、夜になると赤い光が見えるんだって。');
    await expect(page.locator('.aq-dialogue-next')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/04-departure-hint.png` });
    await page.locator('.aq-dialogue-backdrop').click();
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
