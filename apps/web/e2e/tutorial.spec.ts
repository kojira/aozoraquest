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
import { handleMove, handleGear } from '../../edge/src/battle-resolver';
import { applyBattleOutcome } from '../../edge/src/battle-reward';
import { shopCraft } from '../../edge/src/shop';
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
    server: { host: '127.0.0.1', port: 4175, strictPort: true },
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

test('Worldの本物の会話・受注・復帰・報告・制作/装備を隔離PDSで操作', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(8_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const npcs = starterTownNpcs(), quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  let state: GameState = { did: DID, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 14, y: 22,
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
    throw new Error(`External request forbidden in tutorial test: ${new URL(url).hostname}`);
  }) as typeof fetch;
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.npcs': { npcs },
    'app.aozoraquest.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.world.quests': { quests }, 'app.aozoraquest.world.scenario': { events: scenario },
    'app.aozoraquest.world.shops': { shops: [shop] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  let accepts = 0, moves = 0;
  let releaseAccept: (() => void) | undefined;
  let delayAccept = false;
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
      else if (url.pathname.endsWith('/quest/accept')) {
        accepts++;
        if (delayAccept) await new Promise<void>((resolve) => { releaseAccept = resolve; });
        result = await handleQuestAccept(env, DID, body.questId, NOW);
      } else if (url.pathname.endsWith('/quest/complete')) result = await handleQuestComplete(env, DID, body.questId, NOW);
      else if (url.pathname.endsWith('/move')) { moves++; result = await handleMove(env, DID, body.dx, body.dy, body.token, NOW); }
      else if (url.pathname.endsWith('/gear')) result = await handleGear(env, DID, body.gear, NOW);
      else if (url.pathname.endsWith('/shop/craft')) result = await shopCraft(env, DID, { ...body, luk: 15 }, NOW);
      else throw new Error(`Unexpected fixture API ${url.pathname}`);
      await route.fulfill({ json: result });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:4175/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await readAll(page); // 3-window onboarding
    await page.keyboard.press('ArrowUp');
    await readAll(page);
    await page.getByRole('button', { name: 'いいえ', exact: true }).click();
    expect(accepts).toBe(0);
    await page.keyboard.press('ArrowUp'); await readAll(page);
    delayAccept = true;
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    await expect.poll(() => accepts).toBe(1);
    const before = moves;
    await page.keyboard.press('ArrowRight');
    expect(moves).toBe(before);
    releaseAccept!(); delayAccept = false;
    await expect(page.getByRole('button', { name: 'はい', exact: true })).toHaveCount(0);
    expect(state.quest?.id).toBe('futaba-slimes');
    // Isolated continuation checkpoint: exercise real reward processing (including 0power),
    // then reload the real page as a player returning from the field would do.
    const outcome = { outcome: 'win' as const, monsterId: 'sky-slime', archetype: 'warrior' as const, luk: 15, rewardSeed: 12345, lossSeed: 67890, rewarded: false };
    expect(applyBattleOutcome(state, outcome).next.quest?.progress).toBe(0);
    state = { ...state, power: 3 };
    for (let i = 0; i < 3; i++) state = applyBattleOutcome(state, { ...outcome, rewarded: true }).next;
    await page.reload();
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    const progressMap = await page.getByLabel('ワールドマップ').boundingBox();
    await page.mouse.click(progressMap!.x + progressMap!.width / 2, progressMap!.y + progressMap!.height / 2);
    await expect(page.getByRole('dialog', { name: 'コマンド' })).toContainText('村人に はなそう');
    await page.screenshot({ path: 'test-results/tutorial-progress.png' });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => state.questsDone?.includes('futaba-slimes')).toBe(true);
    await expect(page.locator('.aq-dialogue-backdrop')).toBeVisible();
    await readAll(page);
    expect(state.power).toBe(4);
    // Re-enter at the actual shop tile (test checkpoint, no real user state is changed).
    state = { ...state, x: village.shop!.x, y: village.shop!.y };
    await page.reload();
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    const map = await page.getByLabel('ワールドマップ').boundingBox();
    await page.mouse.click(map!.x + map!.width / 2, map!.y + map!.height / 2);
    await page.getByRole('button', { name: 'なんでも屋', exact: true }).click();
    await readAll(page);
    await expect(page.getByText(/ぬののふく/).first()).toBeVisible();
    const cloth = page.getByText('ぬののふく', { exact: true }).locator('..').locator('..').locator('..');
    await cloth.getByRole('button', { name: 'つくってもらう', exact: true }).click();
    await page.getByRole('button', { name: 'つくる!', exact: true }).click();
    await expect.poll(() => state.pieces?.length).toBe(1);
    expect(state.power).toBe(0);
    await expect(page.locator('.aq-dialogue-backdrop')).toBeVisible();
    await readAll(page);
    await page.getByRole('button', { name: 'とじる', exact: true }).click();
    await page.mouse.click(map!.x + map!.width / 2, map!.y + map!.height / 2);
    await page.getByRole('button', { name: 'そうび', exact: true }).click();
    await page.getByRole('button', { name: 'そうびする', exact: true }).click();
    await expect.poll(() => state.gearSel?.armor).toEqual({ id: 'ar-cloth', level: state.pieces![0]!.level });
    await page.screenshot({ path: 'test-results/tutorial-equipped.png' });
    await page.getByRole('button', { name: 'とじる', exact: true }).click();
    // Materials already collected before accepting are handed over by the real handler.
    for (const [id, x, y] of [['futaba-herbs', 9, 13], ['futaba-wings', 22, 13]] as const) {
      state = { ...state, x, y, materials: { ...state.materials, herb: 3, 'bat-wing': 2 } };
      await page.reload();
      await expect(page.getByLabel('ワールドマップ')).toBeVisible();
      await page.keyboard.press('ArrowUp'); await readAll(page);
      await page.getByRole('button', { name: 'はい', exact: true }).click();
      await expect.poll(() => state.quest?.id).toBe(id);
      await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => state.questsDone?.includes(id)).toBe(true);
      await expect(page.locator('.aq-dialogue-backdrop')).toBeVisible();
      await readAll(page);
    }
    expect(state.flags).toContain('futaba_wings_done');
    expect(errors).toEqual([]);
  } finally {
    releaseAccept?.();
    globalThis.fetch = originalFetch;
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null);
  }
});
