import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** カジノの窓 (D-CASINO-001) が 390px からはみ出さない。CASINO_SHOTS を指定するとスクリーンショットを残す。 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4186, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.CASINO_SHOTS;
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
};
const open = async (page: Page, view: string, extra = '') => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:4186/e2e/fixtures/casino.html?view=${view}${extra}`);
};
/** 窓 (dq-window) が画面の中にあり、ボタン (buttons の中) はどれも高さ 44px 以上。 */
async function fits(page: Page, buttons = '.dq-window button') {
  const box = (await page.locator('.dq-window').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  for (const b of await page.locator(buttons).all()) {
    if (!(await b.isVisible())) continue;
    const t = await b.textContent();
    if (t === 'とじる') continue;
    expect((await b.boundingBox())!.height, t ?? '').toBeGreaterThanOrEqual(44);
  }
}

test('両替: 最初は注意、わかった で 1・10・50 (390px)', async ({ page }) => {
  await open(page, 'exchange');
  await expect(page.getByRole('note')).toContainText('コインはパワーに戻せません');
  await shot(page, 'casino-exchange-first.png');
  await page.getByRole('button', { name: 'わかった' }).click();
  await page.getByRole('button', { name: /パワー 10/ }).click();
  await expect(page.getByRole('status')).toContainText('コイン 100 枚');
  await fits(page);
  await shot(page, 'casino-exchange.png');
});

test('スロット (390px)', async ({ page }) => {
  await open(page, 'slots');
  await page.getByRole('button', { name: 'まわす' }).click();
  await expect(page.getByRole('status')).toContainText('1500 枚');
  await fits(page);
  await shot(page, 'casino-slots.png');
});

test('ハイロー (390px)', async ({ page }) => {
  await open(page, 'highlow');
  await page.getByRole('button', { name: 'くばる' }).click();
  await page.getByRole('button', { name: /^上/ }).click();
  await expect(page.getByRole('status')).toContainText('もう1回いきますか');
  await fits(page);
  await shot(page, 'casino-highlow.png');
});

test('レース (390px)', async ({ page }) => {
  await open(page, 'race');
  await expect(page.getByRole('radio', { name: /1ばん にんき/ })).toBeVisible();
  await fits(page);
  await shot(page, 'casino-race.png');
  await page.getByRole('button', { name: '1ばんに 賭ける' }).click();
  await expect(page.getByRole('status')).toContainText('いちばんに ゴール', { timeout: 8000 });
  await shot(page, 'casino-race-goal.png');
});

test('景品の一覧 (390px)', async ({ page }) => {
  await open(page, 'prize');
  await expect(page.getByRole('button', { name: 'ほしのダイスを 12000 枚で こうかん' })).toBeEnabled();
  await fits(page);
  await shot(page, 'casino-prizes.png');
});

test('なかまの なまえを かえる (390px)', async ({ page }) => {
  await open(page, 'rename');
  await page.getByRole('button', { name: 'ミオの なまえを かえる' }).click();
  await page.getByRole('textbox', { name: 'あたらしい なまえ' }).fill('ソラ');
  await fits(page, '[role="group"] button, button[aria-label$="なまえを かえる"]'); // 名前を押す ボタンは既存の部品
  await expect(page.getByRole('textbox', { name: 'あたらしい なまえ' })).toBeInViewport();
  await shot(page, 'party-rename.png');
  await page.getByRole('button', { name: 'きめる' }).click();
  await expect(page.getByRole('button', { name: 'ソラの つよさ' })).toBeVisible();
});
