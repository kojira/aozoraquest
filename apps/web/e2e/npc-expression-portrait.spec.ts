import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import {
  starterTownInterior, starterTownGates, starterTownNpcs, starterTownQuests, starterTownScenario, starterTownShop,
  worldOverlay, townShopStock, setInteriors, setNpcs, setGameQuests, setScenario, setShopOverrides, encodeWorldMap, type NpcImage,
} from '@aozoraquest/core';
import { cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';

// D-DIALOGUE-005: a `[sad]` line shows the registered sad portrait with the tag hidden; the next
// untagged line returns to the normal portrait without a blank or re-downloaded frame.
const DID = 'did:plc:tutorial';
const ADMIN = 'did:plc:tutorialadmin';
const NOW = 1_700_000_000;
const OUT = process.env.D005_OUT ?? 'test-results/npc-expression-portrait';
const SAD_LINE = 'おにいちゃんが、いなくなっちゃったの。そしたら、空の色も……';
const NEXT_LINE = 'でも、きっと また 会えるよね。';
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
    server: { host: '127.0.0.1', port: 4181, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

const imageOf = (bytes: Buffer): NpcImage => ({ blob: { $type: 'blob', ref: { $link: cidFor(bytes) }, mimeType: 'image/webp', size: bytes.length }, width: 512, height: 768 });
type Frame = { t: number; mark?: string; img?: number; shown?: boolean; sad?: boolean; text?: string | null };
test('[sad] の行は表情イラストを出し、タグを表示しない。次の行は空白なしで通常の絵に戻る (D-DIALOGUE-005)', async ({ page }) => {
  test.setTimeout(120_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const smile = readFileSync(path.join(process.cwd(), 'src/assets/futaba/bluesky-smile.webp'));
  const worried = readFileSync(path.join(process.cwd(), 'src/assets/futaba/bluesky-worried.webp'));
  const npcs = starterTownNpcs().map((n) => n.id === 'futaba-bluesky'
    ? { ...n, portraitImage: imageOf(smile), expressionImages: { sad: imageOf(worried) }, lines: [`[sad]${SAD_LINE}`, NEXT_LINE] } : n);
  const quests = starterTownQuests(), scenario = starterTownScenario();
  const shop = starterTownShop(town, townShopStock(town, 0));
  setInteriors([village], gates); setNpcs(npcs); setGameQuests(quests); setScenario(scenario); setShopOverrides([shop]);
  const bluesky = npcs.find((n) => n.id === 'futaba-bluesky')!;
  const state: GameState = { did: DID, activeQuests: [], power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: bluesky.x, y: bluesky.y + 1,
    mapId: village.id, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  const env = await tutorialEnv(NOW);
  const records: Record<string, unknown> = {
    'app.aozoraquest.world.npcs': { npcs },
    'app.aozoraquest.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.world.quests': { quests }, 'app.aozoraquest.world.scenario': { events: scenario },
    'app.aozoraquest.world.shops': { shops: [shop] },
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  await page.addInitScript(() => {
    localStorage.setItem('aq-world-onboarding-done', '1');
    // Per animation frame: portrait <img> identity, whether it paints a decoded image, which one, body text.
    const w = window as unknown as { __frames: unknown[] };
    w.__frames = [];
    const ids = new WeakMap<Element, number>();
    let nextId = 1;
    const tick = () => {
      const img = document.querySelector<HTMLImageElement>('img[alt$="の会話イラスト"]');
      if (img && !ids.has(img)) ids.set(img, nextId++);
      const panes = document.querySelectorAll<HTMLElement>('.aq-dialogue-pane');
      w.__frames.push({ t: Math.round(performance.now()), img: img ? ids.get(img) : 0, shown: !!img && img.naturalWidth > 0,
        sad: !!img && img.currentSrc.includes('expression=sad'), text: panes.length ? panes[panes.length - 1]!.innerText.slice(0, 18) : null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const imageRequests: string[] = [];
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
      const sad = url.searchParams.get('expression') === 'sad';
      imageRequests.push(url.search);
      await new Promise((r) => setTimeout(r, 600)); // Live edge latency order (D-DIALOGUE-004 measured 0.6-2.2 s).
      await route.fulfill({ status: 200, contentType: 'image/webp', body: sad ? worried : smile });
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
    await page.goto('http://127.0.0.1:4181/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await page.keyboard.press('ArrowUp'); // First visit: reunion lines, then menu.
    await expect(window).toContainText('来てくれたんだね。');
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(512);
    for (let i = 0; i < 4; i++) await next();
    await page.getByRole('button', { name: '話す', exact: true }).click();
    await expect(window).toContainText(SAD_LINE.slice(0, 10));
    await expect(window).not.toContainText('[sad]');
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.complete && img.currentSrc.includes('expression=sad'))).toBe(true);
    await page.screenshot({ path: `${OUT}/sad-line.png` });
    await mark('sad');
    await next(); await next(); // Finish typing, then advance to the untagged line.
    await expect(window).toContainText(NEXT_LINE.slice(0, 8));
    await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.complete && !img.currentSrc.includes('expression='))).toBe(true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/next-line.png` });
    await mark('end');
    const frames = await page.evaluate(() => (globalThis as unknown as { __frames: Frame[] }).__frames);
    writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames));
    writeFileSync(`${OUT}/image-requests.json`, JSON.stringify(imageRequests));
    const from = frames.findIndex((f) => f.mark === 'sad'), to = frames.findIndex((f) => f.mark === 'end');
    const steps = frames.slice(from + 1, to).filter((f) => !f.mark);
    expect(steps[0]!.sad).toBe(true);
    expect(steps.some((f) => f.text?.startsWith(NEXT_LINE.slice(0, 8)) && !f.sad)).toBe(true);
    // Every frame across the line change paints a loaded portrait (never a blank/loading one).
    expect(steps.filter((f) => !f.img || !f.shown).map((f) => `${f.t}:img${f.img}:${f.shown}:${f.text}`)).toEqual([]);
    expect(frames.some((f) => f.text?.includes('['))).toBe(false);
    // The normal portrait element stays mounted: going back to it does not download it again.
    expect(imageRequests.filter((q) => q.includes('expression=sad'))).toHaveLength(1);
    expect(imageRequests.filter((q) => !q.includes('expression='))).toHaveLength(1);
  } finally {
    setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, []); setShopOverrides(null);
  }
});
