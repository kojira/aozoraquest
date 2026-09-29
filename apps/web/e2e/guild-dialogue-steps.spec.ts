import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import {
  starterTownInterior, starterTownGates, starterTownNpcs, starterTownQuests, starterTownScenario, starterTownShop,
  worldOverlay, townShopStock, setInteriors, setNpcs, setGameQuests, setScenario, setShopOverrides, encodeWorldMap,
} from '@aozoraquest/core';
import { cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';

// D-DIALOGUE-004: guild steps (welcome → menu → 話す) must keep one dialogue surface: the dimmed
// backdrop never flashes bright and the managed portrait never blanks while it re-downloads.
const DID = 'did:plc:tutorial';
const ADMIN = 'did:plc:tutorialadmin';
const NOW = 1_700_000_000;
const OUT = process.env.D004_OUT ?? 'test-results/guild-dialogue-steps';
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
    server: { host: '127.0.0.1', port: 4180, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

type Frame = { t: number; mark?: string; img?: number; decoded?: boolean; alpha?: number | null; text?: string | null };
test('ギルドの会話送りで背景が明滅せず、会話イラストが消えない (D-DIALOGUE-004)', async ({ page }) => {
  test.setTimeout(120_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const portraitBytes = readFileSync(path.join(process.cwd(), 'src/assets/futaba/bluesky-smile.webp'));
  const portraitImage = { blob: { $type: 'blob' as const, ref: { $link: cidFor(portraitBytes) }, mimeType: 'image/webp' as const, size: portraitBytes.length }, width: 512, height: 768 };
  const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky' ? { ...n, portraitImage } : n), quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  const state: GameState = { did: DID, activeQuests: [], power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x, y: bluesky.y + 1,
    mapId: village.id, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const env = await tutorialEnv(NOW);
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.npcs': { npcs },
    'app.aozoraquest.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.world.quests': { quests }, 'app.aozoraquest.world.scenario': { events: scenario },
    'app.aozoraquest.world.shops': { shops: [shop] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  await page.addInitScript(() => {
    localStorage.setItem('aq-world-onboarding-done', '1');
    // Per animation frame: which <img> element (identity), decoded, backdrop alpha, body text.
    const w = window as unknown as { __frames: unknown[] };
    w.__frames = [];
    const ids = new WeakMap<Element, number>();
    let nextId = 1;
    const tick = () => {
      const img = document.querySelector<HTMLImageElement>('img[alt$="の会話イラスト"]');
      if (img && !ids.has(img)) ids.set(img, nextId++);
      const bd = document.querySelector<HTMLElement>('.aq-dialogue-backdrop');
      const panes = document.querySelectorAll<HTMLElement>('.aq-dialogue-pane');
      const alpha = bd ? Number(getComputedStyle(bd).backgroundColor.match(/[\d.]+/g)?.[3] ?? 1) : null;
      w.__frames.push({ t: Math.round(performance.now()), img: img ? ids.get(img) : 0, decoded: !!img && img.complete && img.naturalWidth > 0,
        alpha, text: panes.length ? panes[panes.length - 1]!.innerText.slice(0, 18) : null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const portraitRequests: number[] = [];
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
    if (url.pathname === '/fixture-api/api/npc-image') {
      // Live dev edge measured 0.6-2.2 s. page.route bypasses the HTTP cache, so every new
      // <img> pays this delay: only keeping the same element mounted avoids a blank portrait.
      portraitRequests.push(Date.now());
      await new Promise((r) => setTimeout(r, 1500));
      await route.fulfill({ status: 200, contentType: 'image/webp', body: portraitBytes });
      return;
    }
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
  const portrait = page.getByRole('img', { name: 'Blueskyちゃんの会話イラスト' });
  const next = () => page.locator('.aq-dialogue-pane').last().click();
  const mark = (label: string) => page.evaluate((l) => (globalThis as unknown as { __frames: Frame[] }).__frames.push({ t: Math.round(performance.now()), mark: l }), label);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:4180/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await page.keyboard.press('ArrowUp'); // First visit: reunion lines, then onDone → menu.
    await expect(window).toContainText('来てくれたんだね。');
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    await page.waitForTimeout(300); // Past the first 140 ms dim-in of the opened window.
    await mark('steps');
    for (let i = 0; i < 4; i++) await next(); // Reunion (2 lines) → onDone → menu (a new npcTalk step).
    await expect(page.getByRole('button', { name: '話す', exact: true })).toBeVisible();
    await page.waitForTimeout(300); // Sample the menu step, too.
    await page.getByRole('button', { name: '話す', exact: true }).click(); // menu → 話す step.
    await expect(window).toContainText('おにいちゃんが、いなくなっちゃったの。');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/talk-400ms.png` });
    await next(); await next(); // 話す done → onDone returns to the menu once more.
    await expect(window).toContainText('どうする？');
    await expect(page.getByRole('button', { name: '話す', exact: true })).toBeVisible();
    await mark('end');
    const frames = await page.evaluate(() => (globalThis as unknown as { __frames: Frame[] }).__frames);
    writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
    writeFileSync(`${OUT}/portrait-requests.json`, JSON.stringify(portraitRequests));
    const from = frames.findIndex((f) => f.mark === 'steps'), to = frames.findIndex((f) => f.mark === 'end');
    const steps = frames.slice(from + 1, to).filter((f) => !f.mark);
    for (const text of ['ここが 村の', '冒険者ギルドへ ようこそ。どうする', 'おにいちゃん']) expect(steps.some((f) => f.text?.startsWith(text))).toBe(true);
    const firstImg = steps[0]!.img;
    // Backdrop stays dimmed (no 0 → .5 re-animation) on every frame of the step changes.
    expect(steps.filter((f) => f.alpha === null || f.alpha! < 0.5).map((f) => `${f.t}:${f.alpha}:${f.text}`)).toEqual([]);
    // The same decoded portrait element persists: no remount, no blank portrait area.
    expect(steps.filter((f) => f.img !== firstImg || !f.decoded).map((f) => `${f.t}:img${f.img}:${f.decoded}:${f.text}`)).toEqual([]);
    expect(portraitRequests).toHaveLength(1);
  } finally {
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null);
  }
});
