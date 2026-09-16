import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { handleMove } from '../../edge/src/battle-resolver';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { setInteriors, setNpcs,
  setGameQuests, setScenario, encodeWorldMap, encodeTileArt, setWorldMap, BASE_PARTS, WORLD_SIZE } from '@aozoraquest/core';
const ONBOARDING_DONE_KEY = 'aq-world-onboarding-done';

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
    }, server: { host: '127.0.0.1', port: 4178, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test.use({ video: { mode: 'on', size: { width: 390, height: 844 } } });

test('real World successful steps are visible, stable on return, and never signalled on collision', async ({ page }) => {
  test.setTimeout(120_000); page.setDefaultTimeout(6000);
  const did = 'did:plc:tutorial', now = 1_700_000_000;
  const env = await tutorialEnv(now);
  let state: GameState = { did, power: 0, playerXp: 0, jobXp: {}, materials: {}, gear: [],
    mapId: 'walking-garden', x: 15, y: 15, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
  let cid = 'initial', revision = 0, moves = 0;
  const diag = { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('pds.fixture.invalid') && url.includes('getRecord')) return Response.json({ cid, value: state });
    if (url.includes('pds.fixture.invalid') && url.includes('putRecord')) {
      state = JSON.parse(init.body as string).record; cid = `r${++revision}`; return Response.json({ cid });
    }
    if (url.includes('getRecord') && url.includes('analysis')) return Response.json({ value: diag });
    throw new Error('External request forbidden in movement test');
  }) as typeof fetch;
  const records: Record<string, any> = {
    'app.aozoraquest.world.npcs': { npcs: [] }, 'app.aozoraquest.world.quests': { quests: [] },
    'app.aozoraquest.world.scenario': { events: [] }, 'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: 15, y: 15, gotStarterFeather: true, regions: [], visitedTowns: [], hp: null, mp: null },
  };
  let responseMode = 'normal';
  let releaseMove: (() => void) | undefined;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      if (op === 'get') { const value = records[params.collection]; await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } }); }
      else if (op === 'put') { records[params.collection] = params.record; await route.fulfill({ json: { uri: 'at://fixture/record' } }); }
      else await route.fulfill({ json: { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    if (!url.pathname.endsWith('/move')) { await route.fulfill({ json: { state } }); return; }
    const body = route.request().postDataJSON(); moves++;
    if (responseMode === 'delay') await new Promise<void>(resolve => { releaseMove = resolve; });
    if (responseMode === 'reject') { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
    if (responseMode === 'same') { await route.fulfill({ json: { x: state.x, y: state.y, mapId: state.mapId, token: null } }); return; }
    try { const result = await handleMove(env, did, body.dx, body.dy, body.token, now); state = { ...state, x: result.x, y: result.y, mapId: result.mapId }; await route.fulfill({ json: result }); }
    catch (error) { const e = error as Error & { status?: number; code?: string }; await route.fulfill({ status: e.status ?? 500, json: { error: e.code, message: e.message } }); }
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(key => { localStorage.setItem(key, '1'); localStorage.setItem('aq-world-menu-hint-done', '1'); localStorage.setItem('aq-world-stick-hint-done', '1'); }, ONBOARDING_DONE_KEY);
    const map = page.getByLabel('ワールドマップ', { exact: true });
    for (const terrain of ['plains', 'grove', 'forest', 'water', 'custom']) {
      const tiles = new Uint8Array(32 * 32);
      // A wall outside the ordinary viewport exercises collision without changing the uniform scene.
      tiles[15 * 32 + 28] = 1;
      const interior = { id: 'walking-garden', name: '散歩の庭', size: 32, tiles,
        parts: [{ name: '地面', terrain: terrain === 'custom' ? 'plains' : terrain, walkable: true }, { name: '壁', terrain: 'mountain', walkable: false }] };
      setInteriors([interior], []); setNpcs([]); setGameQuests([]); setScenario([]);
      records['app.aozoraquest.world.interiors'] = { interiors: [{ ...interior, tiles: undefined, gz: Buffer.from(await encodeWorldMap(tiles)).toString('base64') }], gates: [] };
      records['app.aozoraquest.world.tileArt'] = { arts: terrain === 'custom' ? { plains: encodeTileArt({ size: 16, palette: ['', '#ae8657'], pixels: new Uint8Array(256).fill(1) }) } : {} };
      state = { ...state, x: 15, y: 15 }; responseMode = 'normal';
      await page.goto('http://127.0.0.1:4178/e2e/fixtures/tutorial.html'); await expect(map).toBeVisible();
      const before = await map.screenshot({ path: `test-results/movement-${terrain}-before.png` });
      await page.keyboard.press('ArrowRight'); await expect.poll(() => state.x, { intervals: [10, 10, 20] }).toBe(16);
      const layer = map.locator('[data-world-scroll]');
      await expect(layer).not.toHaveAttribute('transform', 'translate(0 0)');
      // Capture the moving terrain at normal animation speed, not a slowed mock.
      await page.screenshot({ path: `test-results/movement-${terrain}-during.png` });
      await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
      const after = await map.screenshot({ path: `test-results/movement-${terrain}-after.png` });
      expect(after.equals(before)).toBe(true); // Same repeat texture, now with visible travel BETWEEN endpoints.
      await page.keyboard.press('ArrowLeft'); await expect.poll(() => state.x).toBe(15);
      await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
      expect((await map.screenshot()).equals(before)).toBe(true);
      await page.reload(); await expect(map).toBeVisible();
      await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
      expect((await map.screenshot()).equals(before)).toBe(true);
    }
    const layer = map.locator('[data-world-scroll]');
    // Same-position correction and a network rejection discard all pending displacement.
    for (const mode of ['same', 'reject']) {
      responseMode = mode;
      const count = moves; await page.keyboard.press('ArrowRight'); await expect.poll(() => moves).toBe(count + 1);
      await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
      await expect(layer).toHaveAttribute('data-world-x', '15');
    }
    responseMode = 'normal'; state = { ...state, x: 27, y: 15 };
    await page.reload(); await expect(map).toBeVisible(); const count = moves;
    await page.keyboard.press('ArrowRight'); await expect(page.getByText('そっちには進めない!')).toBeVisible();
    expect(moves).toBe(count); await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    // Restore ordinary textured plains and the start checkpoint for the actual held stick.
    records['app.aozoraquest.world.tileArt'] = { arts: {} };
    state = { ...state, x: 15, y: 15 }; await page.reload(); await expect(map).toBeVisible();
    await page.evaluate(() => {
      const frames: { t: number; x: number; y: number; tx: number; ty: number }[] = [];
      (window as any).scrollFrames = frames;
      (window as any).recordScroll = true;
      const sample = (t: number) => { setTimeout(() => {
        const el = document.querySelector('[data-world-scroll]')!;
        const [tx, ty] = (el.getAttribute('transform') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [0, 0];
        frames.push({ t, x: Number(el.getAttribute('data-world-x')) - tx! / 32, y: Number(el.getAttribute('data-world-y')) - ty! / 32, tx: tx!, ty: ty! });
        if ((window as any).recordScroll) requestAnimationFrame(sample);
      }, 0); };
      requestAnimationFrame(sample);
    });
    const box = (await map.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 42, box.y + box.height / 2);
    await expect.poll(() => state.x).toBeGreaterThanOrEqual(20);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 42);
    await expect.poll(() => state.y).toBeGreaterThanOrEqual(19);
    await page.mouse.up();
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    const stopped = moves;
    await page.waitForTimeout(220); expect(moves).toBe(stopped);
    const frames = await page.evaluate(() => { (window as any).recordScroll = false; return (window as any).scrollFrames as { t: number; x: number; y: number; tx: number; ty: number }[]; });
    writeFileSync('test-results/held-scroll-frames.json', JSON.stringify(frames));
    await test.info().attach('held-scroll-frames', { body: JSON.stringify(frames), contentType: 'application/json' });
    // First/last boundary frames and the turn are excluded; the straight middle must keep moving.
    const straight = frames.filter(f => f.x > 16 && f.x < 19.5 && f.y === 15);
    expect(straight.length).toBeGreaterThan(12);
    for (let i = 1; i < straight.length; i++) {
      expect(straight[i]!.x).toBeGreaterThanOrEqual(straight[i - 1]!.x);
      // Integer dot rounding / callback phase may repeat ONE refresh, not a tile pause.
      if (i > 1) expect(straight[i]!.x).toBeGreaterThan(straight[i - 2]!.x);
      expect(straight[i]!.x - straight[i - 1]!.x).toBeLessThan(0.35);
    }
    expect(Math.max(...frames.map(f => Math.abs(f.tx) + Math.abs(f.ty)))).toBeLessThan(65);
    // Native key-repeat burst also retains its current rendering offset and finishes exactly.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(35);
    }
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    // Reduced motion has no intermediate scroll, including a live preference change.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const x = state.x; await page.keyboard.press('ArrowLeft'); await expect.poll(() => state.x).toBe(x! - 1);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    responseMode = 'delay'; const delayedMoves = moves;
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => !!releaseMove).toBe(true);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await page.keyboard.press('ArrowLeft'); expect(moves).toBe(delayedMoves + 1); // existing busy guard
    releaseMove!(); responseMode = 'normal';
    await expect.poll(() => state.x).toBe(x! - 2);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)'); // matching success never restarts

    const room = { id: 'walking-garden', name: '散歩の庭', size: 32, tiles: new Uint8Array(1024), parts: [{ name: '地面', terrain: 'plains', walkable: true }] };
    const destination = { ...room, id: 'other-room', name: '次の部屋' };
    const gate = { from: { mapId: room.id, x: 16, y: 15 }, to: { mapId: destination.id, x: 3, y: 3 } };
    setInteriors([room, destination], [gate]);
    records['app.aozoraquest.world.interiors'] = { interiors: await Promise.all([room, destination].map(async interior => ({ ...interior, tiles: undefined, gz: Buffer.from(await encodeWorldMap(interior.tiles)).toString('base64') }))), gates: [gate] };
    state = { ...state, mapId: room.id, x: 15, y: 15 }; await page.reload(); await expect(map).toBeVisible();
    await page.keyboard.press('ArrowRight'); await expect.poll(() => state.mapId).toBe(destination.id);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await expect(layer).toHaveAttribute('data-world-x', '3');
    await expect(page.getByText('🚪 次の部屋', { exact: true })).toBeVisible();

    // Field wrap uses input delta (1 tile), never 1023 tiles of camera displacement.
    const water = new Uint8Array(WORLD_SIZE * WORLD_SIZE).fill(4);
    const parts = BASE_PARTS.map(part => ({ ...part, walkable: true })); // fixture only, no new movement permission
    setWorldMap({ size: WORLD_SIZE, tiles: water, parts }); setInteriors([], []);
    records['app.aozoraquest.world.interiors'] = { interiors: [], gates: [] };
    records['app.aozoraquest.world.map'] = { size: WORLD_SIZE, gz: Buffer.from(await encodeWorldMap(water)).toString('base64'), parts };
    delete state.mapId; state = { ...state, x: 1023, y: 500 };
    records['app.aozoraquest.test.world'] = { ...records['app.aozoraquest.test.world'], x: 1023, y: 500, mapId: undefined };
    await page.reload(); await expect(map).toBeVisible();
    await page.keyboard.press('ArrowRight'); await expect.poll(() => state.x).toBe(0);
    const displacement = await layer.getAttribute('transform');
    expect(Math.max(...(displacement!.match(/-?[\d.]+/g)!.map(Number).map(Math.abs)))).toBeLessThanOrEqual(32);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await page.keyboard.press('ArrowLeft'); await expect.poll(() => state.x).toBe(1023);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    await page.keyboard.press('ArrowRight');
    await expect(layer).not.toHaveAttribute('transform', 'translate(0 0)');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    // Upward movement brings a padded NPC into view with the same transform as the ground.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const npc = { id: 'scroll-edge', name: '旅人', spritePreset: 'old-man' as const, mapId: room.id, x: 18, y: 6, lines: ['こんにちは'] };
    setInteriors([room], []); setNpcs([npc]);
    records['app.aozoraquest.world.interiors'] = { interiors: [{ ...room, tiles: undefined, gz: Buffer.from(await encodeWorldMap(room.tiles)).toString('base64') }], gates: [] };
    records['app.aozoraquest.world.npcs'] = { npcs: [npc] };
    state = { ...state, mapId: room.id, x: 15, y: 15 };
    await page.reload(); await expect(map).toBeVisible();
    await expect(layer.locator('.npc-sprite')).toHaveCount(1);
    const upward = page.evaluate(async () => {
      const frames: { terrain: number; npc: number }[] = [];
      const started = performance.now();
      await new Promise<void>(resolve => {
        const sample = () => {
          const layer = document.querySelector<SVGGElement>('[data-world-scroll]')!;
          const npc = layer.querySelector<SVGGElement>('.npc-sprite')!;
          const svg = layer.ownerSVGElement!;
          // Screen matrices include inherited movement; convert back to SVG pixels.
          const matrix = svg.getScreenCTM()!.inverse();
          frames.push({ terrain: matrix.multiply(layer.getScreenCTM()!).f, npc: matrix.multiply(npc.getScreenCTM()!).f });
          if (performance.now() - started < 350) requestAnimationFrame(sample); else resolve();
        };
        requestAnimationFrame(sample);
      });
      return frames;
    });
    await page.keyboard.press('ArrowUp'); await expect.poll(() => state.y).toBe(14);
    await expect(layer).toHaveAttribute('transform', 'translate(0 0)');
    const upFrames = await upward;
    expect(upFrames.some(f => f.npc > -32 && f.npc < -1)).toBe(true);
    for (const f of upFrames.filter(f => f.terrain < -1)) expect(f.npc).toBeCloseTo(f.terrain, 4);
    expect(upFrames.at(-1)!.npc).toBeCloseTo(0, 4);
    writeFileSync('test-results/upward-npc-scroll-frames.json', JSON.stringify(upFrames));
    await page.screenshot({ path: 'test-results/upward-npc-scroll.png' });
    expect(errors).toEqual([]);
  } finally { globalThis.fetch = originalFetch; setWorldMap(null); }
});
