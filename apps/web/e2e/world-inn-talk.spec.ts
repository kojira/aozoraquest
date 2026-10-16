import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { tutorialEnv } from '../../edge/test/support/tutorial-env';
import { TEST_MONSTERS } from '../../../packages/core/src/__tests__/helpers/monster-fixture';
import { starterTownInterior, starterTownGates, starterTownNpcs, worldOverlay, setInteriors, setNpcs, encodeWorldMap, setMonsterOverrides, clearMonsters } from '@aozoraquest/core';
import { handleMove } from '../../edge/src/battle-resolver';
import { handleInnRest } from '../../edge/src/inn-rest';
import { XP_EPOCH, type GameState } from '../../edge/src/game-state';
import { readFileSync } from 'node:fs';
const DIALOGUE_FIXTURE = JSON.parse(readFileSync(path.join(process.cwd(), '../../packages/core/src/__tests__/fixtures/dialogue.json'), 'utf8'));

// 宿屋 (#766): 扉に入るだけでは泊まらず、会話で「はい」と答えたときだけ edge が泊める。
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
    server: { host: '127.0.0.1', port: 4184, strictPort: true },
  });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

async function readUntilChoice(page: Page) {
  for (let i = 0; i < 24 && await page.locator('.aq-dialogue-backdrop').count(); i++) {
    if (await page.getByRole('button', { name: 'はい', exact: true }).count()) return;
    await page.locator('.aq-dialogue-pane').last().click();
  }
}

test('宿屋の扉: いいえ なら課金しない、はい で パワー -3 と回復', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(8_000);
  const town = worldOverlay().towns[0]!;
  const village = starterTownInterior(town);
  const gates = starterTownGates(town);
  const npcs = starterTownNpcs();
  const inn = village.inn!;
  setMonsterOverrides(TEST_MONSTERS);
  setInteriors([village], gates); setNpcs(npcs);
  // 扉の真下に立ち、傷ついている (満タンなら edge は課金しない)。
  let state: GameState = { did: DID, activeQuests: [], power: 10, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: inn.x, y: inn.y + 1,
    mapId: village.id, carryHp: 3, carryMp: 1, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };
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
    throw new Error(`External request forbidden in inn test: ${new URL(url).hostname}`);
  }) as typeof fetch;
  const records: Record<string, unknown> = {
    'app.aozoraquest.dev.world.monsters': { monsters: TEST_MONSTERS },
    'app.aozoraquest.dev.world.npcs': { npcs },
    // 会話の文はデータだけが正 (D-DIALOGUE-006)。付録Aと同じ fixture。
    'app.aozoraquest.dev.world.dialogue': DIALOGUE_FIXTURE,
    'app.aozoraquest.dev.world.interiors': { interiors: [{ ...village, tiles: undefined, gz: Buffer.from(await encodeWorldMap(village.tiles)).toString('base64') }], gates },
    'app.aozoraquest.test.analysis': diag,
    'app.aozoraquest.test.world': { x: town.x, y: town.y, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: 3, mp: 1 },
  };
  let rests = 0;
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
      else if (url.pathname.endsWith('/move')) result = await handleMove(env, DID, body.dx, body.dy, body.token, NOW);
      else if (url.pathname.endsWith('/inn/rest')) { rests++; result = await handleInnRest(env, DID, body.token, NOW); }
      else if (url.pathname.endsWith('/gear')) result = {};
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
    await page.goto('http://127.0.0.1:4184/e2e/fixtures/tutorial.html');
    await expect(page.getByLabel('ワールドマップ')).toBeVisible();
    await readUntilChoice(page); // 導入 + 操作ガイド
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);

    // 1 回目: 扉に入る → 確認 → いいえ。入っただけでは引かれない。
    await page.keyboard.press('ArrowUp');
    const pane = page.locator('.aq-dialogue-pane').last();
    await expect(pane).toContainText('一晩3パワーです。泊まっていきますか？');
    await expect(page.getByLabel('ふたばの宿のセリフ')).toBeVisible(); // 話者は inn.name
    await expect(page.getByRole('button', { name: 'いいえ', exact: true })).toBeVisible();
    await page.screenshot({ path: `${process.env.INN_SHOTS ?? 'test-results'}/inn-390.png` });
    await page.getByRole('button', { name: 'いいえ', exact: true }).click();
    await expect(pane).toContainText('またどうぞ。');
    await pane.click();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    expect(rests).toBe(0);
    expect(state.power).toBe(10);
    expect(state.carryHp).toBe(3);

    // 2 回目: 一度出て入り直す → はい。edge が パワー -3 で全回復させる。
    const stepped = page.waitForResponse((r) => r.url().endsWith('/api/world/move'));
    await page.keyboard.press('ArrowDown');
    await stepped; // 往復中に押した次の一歩は捨てられる (#762) ので、応答を待ってから入り直す。
    await page.keyboard.press('ArrowUp');
    await expect(pane).toContainText('泊まっていきますか？');
    await page.getByRole('button', { name: 'はい', exact: true }).click();
    await expect(pane).toContainText('ふたばの宿に泊まった (パワー -3)。すっかり元気になった!');
    expect(rests).toBe(1);
    expect(state.power).toBe(7);
    expect(state.carryHp).toBeUndefined();
    expect(state.carryMp).toBeUndefined();
    await pane.click();
    await expect(pane).toContainText('ゆっくり休めたかい？　またどうぞ。');
    await pane.click();
    await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    globalThis.fetch = originalFetch;
    setNpcs(null); setInteriors(null, []); clearMonsters();
  }
});
