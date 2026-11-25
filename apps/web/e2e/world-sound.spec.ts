import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { worldOverlay, setInteriors, setNpcs, setGameQuests, setScenario } from '@aozoraquest/core';

/**
 * D-SOUND-001: 390px のワールドで、はじめから ON・最初のタップまで鳴らない・右上の 🔊/🔇 で止まり覚えている、
 * 戦闘で曲が替わる、設定の BGM / 効果音。AQ_SOUND_SHOT_DIR があればスクショを書く。
 */
const PORT = 4196;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:tutorialadmin'), 'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const shot = (name: string) => (process.env.AQ_SOUND_SHOT_DIR ? { path: path.join(process.env.AQ_SOUND_SHOT_DIR, name) } : {});

const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 30, mp: 5, maxMp: 5, atk: 1, def: 1, agi: 1, int: 1, luk: 1, vit: 0, guarding: false, parrying: false, charging: false, focus: 0, statuses: [], passives: [] });
const battle = () => ({
  seed: 0, turn: 0, player: fighter('たびびと', 30), monster: fighter('テストスライム', 30), monsterId: 'none', outcome: 'ongoing',
  playerSkill: { name: 'わざ', kind: 'smash' }, playerSkills: [{ name: 'わざ', kind: 'smash' }],
  herbs: 0, herbsUsed: 0, tonics: 0, tonicsUsed: 0, mpAttackGain: 0, mpGuardGain: 0, lastEvents: [],
});

async function openWorld(page: Page, query = '') {
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  setInteriors([], []); setNpcs([]); setGameQuests([]); setScenario([]);
  const state = { did: 'did:plc:tutorial', power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: 1, version: 1, updatedAt: '' };
  const records: Record<string, unknown> = {
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname === '/fixture-pds') {
      const { op, params } = route.request().postDataJSON();
      const value = op === 'get' ? records[params.collection] : undefined;
      if (op === 'get') await route.fulfill({ status: value ? 200 : 404, json: value ? { value, cid: 'fixture' } : { error: 'RecordNotFound' } });
      else await route.fulfill({ json: op === 'put' ? { uri: 'at://fixture/record' } : { records: [] } });
      return;
    }
    if (!url.pathname.startsWith('/fixture-api/')) { await route.continue(); return; }
    if (url.pathname.endsWith('/me/state')) { await route.fulfill({ json: { state, initialized: false } }); return; }
    if (url.pathname.endsWith('/move')) {
      await route.fulfill({ json: { x: start.x, y: start.y - 1, terrain: 'grass', token: 't1', encounter: { battleId: 'b1', monsterId: 'none', rewarded: true, state: battle() } } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'unexpected' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`http://127.0.0.1:${PORT}/e2e/fixtures/world-shell.html${query}`);
}

/** 実際の Web Audio を数える: 作った AudioContext の数と、鳴らした音 (長さ・ループ)。 */
const countAudio = () => {
  const w = window as unknown as { aqCtx: number; aqStarts: { length: number; loop: boolean }[] };
  w.aqCtx = 0; w.aqStarts = [];
  const Orig = window.AudioContext;
  window.AudioContext = class extends Orig { constructor(o?: AudioContextOptions) { super(o); w.aqCtx++; } } as typeof AudioContext;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof start>) {
    if ((this.buffer?.length ?? 0) > 1) w.aqStarts.push({ length: this.buffer!.length, loop: this.loop });
    return start.apply(this, a);
  };
};
const audio = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { aqCtx: number; aqStarts: { length: number; loop: boolean }[] };
  return { ctx: w.aqCtx, loops: w.aqStarts.filter((s) => s.loop).map((s) => s.length), others: w.aqStarts.filter((s) => !s.loop).length };
});

test('はじめから ON: 最初のタップで field が始まり、戦闘で battle に替わる。🔊 で止まりリロードしても覚えている', async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.addInitScript(countAudio);
  await openWorld(page);
  const map = page.getByLabel('ワールドマップ', { exact: true });
  await expect(map).toBeVisible();
  const mute = page.getByRole('button', { name: '音を消す (ミュート)' });
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  // 右上の 🔊 は HUD (HP/MP・現在地) と重ならない
  const mb = (await mute.boundingBox())!;
  for (const el of await page.locator('[data-hud-location], [data-hud-hit], div:has(> div > span:text-is("HP"))').all()) {
    const b = await el.boundingBox();
    if (b) expect(b.x + b.width <= mb.x || b.y >= mb.y + mb.height || mb.x + mb.width <= b.x).toBe(true);
  }
  await page.waitForTimeout(500);
  expect(await audio(page)).toEqual({ ctx: 0, loops: [], others: 0 }); // タップの前は何もしない
  await page.screenshot(shot('world-hud-sound-on-390.png'));
  // 最初のタップ (マップの下の黒い領域) で field が鳴る
  const m = (await map.boundingBox())!, foot = (await page.locator('.footer-nav').boundingBox())!;
  await page.touchscreen.tap(m.x + m.width / 2, (m.y + m.height + foot.y) / 2);
  await expect.poll(async () => (await audio(page)).loops.length).toBe(1);
  const field = (await audio(page)).loops[0]!;
  // 戦闘: battle の曲に替わる (長さの違う 2 本目のループ)
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.dq-message')).toContainText('テストスライムがあらわれた');
  await expect.poll(async () => (await audio(page)).loops.length).toBe(2);
  expect((await audio(page)).loops[1]).not.toBe(field);
  // ミュート: 押すと 🔇 になり、効果音も鳴らない。リロードしても覚えている
  await mute.tap();
  const muted = page.getByRole('button', { name: 'ミュート中 (押すと音を出す)' });
  await expect(muted).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot(shot('world-hud-sound-muted-battle-390.png'));
  const before = (await audio(page)).others;
  await page.touchscreen.tap(m.x + m.width / 2, (m.y + m.height + foot.y) / 2);
  await page.getByRole('button', { name: 'たたかう' }).waitFor();
  await page.getByRole('button', { name: 'ぼうぎょ' }).tap().catch(() => undefined);
  expect((await audio(page)).others).toBe(before);
  await page.reload();
  await expect(page.getByLabel('ワールドマップ', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ミュート中 (押すと音を出す)' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot(shot('world-hud-sound-muted-390.png'));
  await page.getByRole('button', { name: 'ミュート中 (押すと音を出す)' }).tap();
  await expect(page.getByRole('button', { name: '音を消す (ミュート)' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await audio(page)).loops.length).toBe(1); // ミュートを外すと場面の曲が鳴る
});

test('設定: BGM と効果音のトグルは はじめから ON、押すと OFF になり覚えている', async ({ page }) => {
  test.setTimeout(60_000);
  await openWorld(page, '?path=/settings');
  const bgm = page.getByText('あおぞらワールドの BGM').locator('xpath=..').getByRole('button');
  const se = page.getByText('効果音', { exact: true }).locator('xpath=..').getByRole('button');
  await expect(bgm).toHaveAttribute('aria-pressed', 'true');
  await expect(se).toHaveAttribute('aria-pressed', 'true');
  await bgm.scrollIntoViewIfNeeded();
  await page.screenshot(shot('settings-sound-390.png'));
  await bgm.tap();
  await expect(bgm).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('aozoraquest:bgm'))).toBe('off');
});
