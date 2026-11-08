import { readFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import {
  starterTownInterior, starterTownGates, starterTownShop,
  worldOverlay, townShopStock, setInteriors, setNpcs, setGameQuests, setScenario, setShopOverrides, encodeWorldMap, setMonsterOverrides, clearMonsters,
} from '@aozoraquest/core';
import { starterTownNpcs, starterTownQuests, starterTownScenario } from '../../../packages/core/src/__tests__/helpers/starter-town-fixture';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
const DIALOGUE_FIXTURE = JSON.parse(readFileSync(path.join(process.cwd(), '../../packages/core/src/__tests__/fixtures/dialogue.json'), 'utf8'));

// E2: an NPC line tagged `[fx:fade-black]` blacks out the map through the scenario-notice effect layer,
// the tag is never shown, and the blackout ends with the conversation (it never leaks onto the map).
const DID = 'did:plc:tutorial';
const ADMIN = 'did:plc:tutorialadmin';
const NOW = 1_700_000_000;
const OUT = process.env.LINE_FX_OUT ?? 'test-results/npc-line-effects';
const FIRST_LINE = 'ねえ、きいて。';
const FADE_LINE = 'あたりが まっくらに なった。';
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
    server: { host: '127.0.0.1', port: 4187, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('[fx:fade-black] の行で地図が暗転し、タグは出ず、会話が終わると元に戻る (E2)', async ({ page }) => {
  test.setTimeout(120_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky'
    ? { ...n, lines: [FIRST_LINE, `[fx:fade-black]${FADE_LINE}`] } : n);
  const quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setMonsterOverrides(TEST_MONSTERS); // quests の monsterId 実在検査より先に入れる (D-MONSTER-001)
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  const state: GameState = { did: DID, activeQuests: [], power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x, y: bluesky.y + 1,
    mapId: village.id, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const env = await tutorialEnv(NOW);
  const records: Record<string, unknown> = {
    // モンスターはレコードだけが正 (D-MONSTER-001)。ブラウザ側もテスト用 fixture をレコードとして読む。
    'app.aozoraquest.dev.world.monsters': { monsters: TEST_MONSTERS },
    'app.aozoraquest.dev.world.npcs': { npcs },
    // 会話の文はデータだけが正 (D-DIALOGUE-006)。付録Aと同じ fixture。
    'app.aozoraquest.dev.world.dialogue': DIALOGUE_FIXTURE,
    'app.aozoraquest.dev.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.dev.world.quests': { quests }, 'app.aozoraquest.dev.world.scenario': { events: scenario },
    'app.aozoraquest.dev.world.shops': { shops: [shop] },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      const record = op === 'get' ? records[params.collection] : undefined;
      if (op === 'get') await route.fulfill({ status: record ? 200 : 404, json: record ? { value: record, cid: 'fixture-cid' } : { error: 'RecordNotFound' } });
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    if (url.pathname === '/fixture-api/api/npc-image') { await route.fulfill({ status: 404, body: 'not found' }); return; }
    const body = route.request().postDataJSON();
    try {
      if (!url.pathname.endsWith('/me/state') && !url.pathname.endsWith('/move')) throw new Error(`Unexpected fixture API ${url.pathname}`);
      await route.fulfill({ json: url.pathname.endsWith('/move') ? await handleMove(env, DID, body.dx, body.dy, body.token, NOW) : { state, initialized: false } });
    } catch (error) {
      const e = error as Error & { status?: number; code?: string };
      await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } });
    }
  });
  mkdirSync(OUT, { recursive: true });
  const window = page.locator('.dq-window').last();
  const black = page.getByTestId('story-black');
  const next = () => page.locator('.aq-dialogue-pane').last().click();
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('http://127.0.0.1:4187/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await page.keyboard.press('ArrowUp'); // First visit: reunion lines, then menu.
    await expect(window).toContainText('来てくれたんだね。');
    for (let i = 0; i < 4; i++) await next();
    await page.getByRole('button', { name: '話す', exact: true }).click();
    await expect(window).toContainText(FIRST_LINE);
    await expect(black).toHaveCSS('opacity', '0');
    await next(); await next(); // Finish typing, then advance to the tagged line.
    await expect(window).toContainText(FADE_LINE.slice(0, 6));
    await expect(black).toHaveCSS('opacity', '1');
    await expect(page.locator('body')).not.toContainText('[fx:');
    await expect(window).toContainText(FADE_LINE); // Typing finished.
    await page.waitForTimeout(800); // The 600 ms fade transition has completed.
    await page.screenshot({ path: `${OUT}/fade-390.png` });
    await next(); // The talk ends (back to the guild menu): the blackout must not stay on the map.
    await expect(page.getByTestId('story-effect-layer')).toHaveCount(0);
    await page.getByRole('button', { name: 'やめる', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('story-effect-layer')).toHaveCount(0);
  } finally {
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null); clearMonsters();
  }
});
