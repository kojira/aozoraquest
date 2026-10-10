import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { worldOverlay, setInteriors, setNpcs, setGameQuests, setScenario } from '@aozoraquest/core';

// #757: 戦闘の message は 1 タップ 1 行。マップの下の黒い領域タップでも送れる (input は出ない)。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_ADMIN_DIDS': JSON.stringify('did:plc:tutorialadmin'), 'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: 4183, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const fighter = (name: string, hp: number) => ({ name, hp, maxHp: 30, mp: 5, maxMp: 5, atk: 1, def: 1, agi: 1, int: 1, luk: 1, vit: 0, guarding: false, parrying: false, charging: false, focus: 0, statuses: [], passives: [] });
const battle = (turn: number, playerHp: number, lastEvents: { actor: string; text: string }[]) => ({
  seed: 0, turn, player: fighter('たびびと', playerHp), monster: fighter('テストスライム', 30), monsterId: 'none', outcome: 'ongoing',
  playerSkill: { name: 'わざ', kind: 'smash' }, playerSkills: [{ name: 'わざ', kind: 'smash' }],
  herbs: 0, herbsUsed: 0, tonics: 0, tonicsUsed: 0, mpAttackGain: 0, mpGuardGain: 0, lastEvents,
});

test('戦闘 message: 黒い領域タップで 1 行ずつ進み、最後の行で HP が減り、input では黒い領域が効かない', async ({ page }) => {
  test.setTimeout(60_000);
  page.setDefaultTimeout(5_000);
  const town = worldOverlay().towns[0]!;
  const start = { x: town.x, y: town.y + 8 };
  setInteriors([], []); setNpcs([]); setGameQuests([]); setScenario([]);
  const state = { did: 'did:plc:tutorial', power: 5, playerXp: 0, jobXp: {}, materials: {}, gear: [], ...start, xpEpoch: 1, version: 1, updatedAt: '' };
  const records: Record<string, unknown> = {
    'app.aozoraquest.test.analysis': { archetype: 'warrior', rpgStats: { atk: 40, def: 15, agi: 15, int: 15, luk: 15 } },
    'app.aozoraquest.test.world': { ...start, gotStarterFeather: true, regions: [town.region], visitedTowns: [], hp: null, mp: null },
  };
  let turns = 0;
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
      await route.fulfill({ json: { x: start.x, y: start.y - 1, terrain: 'grass', token: 't1', encounter: { battleId: 'b1', monsterId: 'none', rewarded: true, state: battle(0, 30, []) } } });
      return;
    }
    if (url.pathname.endsWith('/battle/turn')) {
      turns++;
      await route.fulfill({ json: { outcome: 'ongoing', events: [], state: battle(1, 22, [
        { actor: 'player', text: 'たびびとのこうげき! テストスライムに 3 のダメージ' },
        { actor: 'monster', text: 'テストスライムのこうげき! たびびとに 8 のダメージ' }]) } });
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'unexpected' } });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('aq-world-onboarding-done', '1'));
  await page.goto('http://127.0.0.1:4183/e2e/fixtures/world-shell.html');
  const map = page.getByLabel('ワールドマップ', { exact: true });
  await expect(map).toBeVisible();
  await page.keyboard.press('ArrowUp');
  const msg = page.locator('.dq-message');
  await expect(msg).toContainText('テストスライムが あらわれた');
  const m = (await map.boundingBox())!, foot = (await page.locator('.footer-nav').boundingBox())!;
  const black = { x: m.x + m.width / 2, y: (m.y + m.height + foot.y) / 2 };
  await page.touchscreen.tap(black.x, black.y);
  const attack = page.getByRole('button', { name: 'たたかう' });
  await expect(attack).toBeVisible();
  // input: 黒い領域タップでは何も押されない
  await page.touchscreen.tap(black.x, black.y);
  await page.waitForTimeout(300);
  expect(turns).toBe(0);
  await attack.tap();
  await expect(msg).toContainText('たびびとのこうげき!');
  await expect(msg).not.toContainText('テストスライムに 3');
  const hud = page.getByText(/30\s*\/\s*30/).first();
  await expect(hud).toBeVisible();
  await page.screenshot({ path: 'test-results/battle-line-1-390.png' });
  for (const line of ['テストスライムに 3 のダメージ', 'テストスライムのこうげき!']) {
    await page.touchscreen.tap(black.x, black.y);
    await expect(msg).toContainText(line);
  }
  await expect(page.getByText(/30\s*\/\s*30/)).toHaveCount(1);
  await page.screenshot({ path: 'test-results/battle-line-2-390.png' });
  await page.touchscreen.tap(black.x, black.y);
  await expect(msg).toContainText('たびびとに 8 のダメージ');
  await expect(page.getByText(/22\s*\/\s*30/)).toBeVisible();
  await page.touchscreen.tap(black.x, black.y);
  await expect(attack).toBeVisible();
  expect(turns).toBe(1);
});
