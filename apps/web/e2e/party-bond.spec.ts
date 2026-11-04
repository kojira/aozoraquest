import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** 仲間との きずな (D-PARTY-004) の 390px の見た目。PARTY_BOND_SHOTS を指定するとスクリーンショットを残す。 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4182, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.PARTY_BOND_SHOTS;
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
};

test('なかま一覧に ♥、つよさに きずな と つぎの ♥ まで (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4182/e2e/fixtures/party-bond.html?view=party');
  await expect(page.getByLabel('きずな ♥2')).toHaveText('♥♥♡');
  await expect(page.getByLabel('きずな ♥1')).toHaveText('♥♡♡');
  await expect(page.getByLabel('きずな ♥3')).toHaveText('♥♥♥');
  for (const label of ['きずな ♥2', 'きずな ♥3']) await expect(page.getByLabel(label)).toBeInViewport();
  await shot(page, 'party-list-hearts.png');
  await page.getByRole('button', { name: 'ミオの つよさ' }).click();
  await expect(page.getByText('きずな 72／150（つぎの ♥ まで 78）')).toBeVisible();
  await shot(page, 'ally-status-bond.png');
});

test('つよさの さくせん (♥3 なら めいれいさせろ も) (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4182/e2e/fixtures/party-bond.html?view=party');
  await page.getByRole('button', { name: 'ソラの つよさ' }).click();
  await expect(page.getByRole('radio', { name: '▸ めいれいさせろ' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'いのちだいじに' })).toBeInViewport();
  await shot(page, 'ally-tactic-select.png');
});

test('めいれい: 主人公の次に ソラ の窓 (とくぎはソラのもの・もどる・おまかせ) (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4182/e2e/fixtures/party-bond.html?view=battle');
  await expect(page.getByText('ゆうしゃ は どうする？（1/2）')).toBeVisible();
  await page.getByRole('button', { name: 'ぼうぎょ' }).click();
  await expect(page.getByText('ソラ は どうする？（2/2）')).toBeVisible();
  for (const name of ['もどる', 'おまかせ']) await expect(page.getByRole('button', { name, exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'にげる' })).toHaveCount(0);
  await shot(page, 'ally-order-panel.png');
  await page.getByRole('button', { name: 'ぼうぎょ' }).click();
  await expect(page.getByTestId('sent')).toContainText('"allies":[{"id":"g:s","command":"guard"}]');
});

test('そうびの「だれの？」: ほかの人が着ている品は「ソラが そうび中」で選べない (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4182/e2e/fixtures/party-bond.html?view=gear');
  await expect(page.getByRole('radiogroup', { name: 'だれの？' })).toBeVisible();
  await expect(page.getByText('ソラが そうび中')).toBeInViewport();
  await shot(page, 'gear-whose-worn.png');
  await page.getByRole('radio', { name: 'ソラ' }).click();
  await expect(page.getByRole('radio', { name: '▸ ソラ' })).toBeVisible();
  await expect(page.getByText('ゆうしゃが そうび中')).toBeVisible();
  await shot(page, 'gear-whose-ally.png');
});
