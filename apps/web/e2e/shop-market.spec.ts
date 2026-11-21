import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** なんでも屋の「中古」「うる」(D-MARKET-001) が 390px で切れない。MARKET_SHOTS を指定するとスクリーンショットを残す。 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4295, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.MARKET_SHOTS;
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
};
const open = async (page: Page, view: string) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:4295/e2e/fixtures/shop-market.html?view=${view}`);
  await expect(page.getByRole('tab', { name: 'みせ' })).toBeAttached();
};
/** 店主のあいさつ (セリフ窓) を送り終える。 */
const closeTalk = async (page: Page) => {
  for (let i = 0; i < 8 && await page.locator('.aq-dialogue-backdrop').count(); i++) await page.locator('.aq-dialogue-pane').last().click();
  await expect(page.locator('.aq-dialogue-backdrop')).toHaveCount(0);
};
/** 窓が画面の中にあり、タブは 1 行、ボタンは切れずに窓の中。 */
async function fits(page: Page) {
  const win = (await page.locator('.dq-window').first().boundingBox())!;
  expect(win.x).toBeGreaterThanOrEqual(0);
  expect(win.x + win.width).toBeLessThanOrEqual(390);
  const tabs = await Promise.all((await page.getByRole('tab').all()).map((t) => t.boundingBox()));
  expect(new Set(tabs.map((b) => Math.round(b!.y))).size).toBe(1);
  for (const b of await page.locator('.dq-window').first().locator('button').all()) {
    if (!(await b.isVisible())) continue;
    const box = (await b.boundingBox())!;
    expect(box.x + box.width, (await b.textContent()) ?? '').toBeLessThanOrEqual(win.x + win.width);
  }
}

test('中古: 安い順・@handle・じぶんの・だれか (390px)', async ({ page }) => {
  await open(page, 'used');
  await closeTalk(page);
  // 「みせ」の装備にも いまとの差 (D-GEAR-DIFF-001)
  await expect(page.getByTestId('gear-delta').first()).toBeVisible();
  await fits(page);
  await shot(page, 'market-shop.png');
  await page.getByRole('tab', { name: '中古' }).click();
  await expect(page.getByRole('link', { name: '@bob.bsky.social' })).toBeVisible();
  await expect(page.getByText('じぶんの')).toBeVisible();
  await expect(page.getByRole('link', { name: 'だれか' })).toBeVisible();
  // いまとの差 (D-GEAR-DIFF-001): こんぼう (こうげき 4) と比べて ナイフ+2 (こうげき 3) は -1
  await expect(page.getByTestId('gear-delta').first()).toHaveText('いまと比べてこうげき -1');
  await fits(page);
  await shot(page, 'market-used.png');
  await page.getByRole('button', { name: 'かう' }).first().click();
  await expect(page.getByRole('button', { name: 'かう!' })).toBeVisible();
  await fits(page);
});

test('うる: 値段の欄と目安・出せない理由 (390px)', async ({ page }) => {
  await open(page, 'sell');
  await closeTalk(page);
  await page.getByRole('tab', { name: 'うる' }).click();
  await expect(page.getByText(/出品中 0\/20（この街 0\/2）/)).toBeVisible();
  await expect(page.getByLabel('ナイフ+3のねだん')).toHaveValue('12');
  await expect(page.getByText('めやす12・手取り10')).toBeVisible();
  await expect(page.getByText('そうび中')).toBeVisible();
  await expect(page.getByText('カジノの けいひんは うれない')).toBeVisible();
  await fits(page);
  await shot(page, 'market-sell.png');
});

test('売れた知らせ (390px)', async ({ page }) => {
  await open(page, 'sold');
  await expect(page.getByText('ナイフ+3が @bob.bsky.social に 売れた！ パワー+36')).toBeVisible();
  // セリフ窓は 1 文字ずつ出る。全部出てから撮る。
  await expect(page.locator('.aq-dialogue-pane span[aria-hidden]').first()).toContainText('売れた！ パワー+36', { timeout: 10_000 });
  await shot(page, 'market-sold.png');
});

test('とりさげ (390px)', async ({ page }) => {
  await open(page, 'cancel');
  await closeTalk(page);
  await page.getByRole('tab', { name: 'うる' }).click();
  await expect(page.getByText(/出品中 1\/20（この街 1\/2）/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'とりさげ' })).toBeVisible();
  await fits(page);
  await shot(page, 'market-cancel.png');
  await page.getByRole('button', { name: 'とりさげ' }).click();
  await expect(page.getByRole('button', { name: 'とりさげ' })).toHaveCount(0);
});
