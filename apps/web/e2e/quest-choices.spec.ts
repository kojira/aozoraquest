import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

// 依頼の一覧 (どの依頼のこと？) が 390px の会話窓からはみ出し、「戻る」が窓の下で切れて抜けられないように見えた。
// 1 ページの依頼と、下端に張りつけた 前へ・次へ・話す・戻る が、スクロールせずに窓の中に見えること。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4188, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.CHOICE_SHOTS;

test('依頼の一覧の選択肢がすべて窓の中に見える (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4188/e2e/fixtures/quest-choices.html');
  const pane = page.locator('.aq-dialogue-pane').last();
  const expectAllInside = async () => {
    const frame = (await pane.boundingBox())!;
    const buttons = await pane.getByRole('button').all();
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) {
      const b = (await button.boundingBox())!;
      expect(b.y, await button.innerText()).toBeGreaterThanOrEqual(frame.y);
      expect(b.y + b.height, await button.innerText()).toBeLessThanOrEqual(frame.y + frame.height);
      // 下端の操作の段やぼかしに覆われていない (上端・下端の近くを押しても、そのボタンに当たる)。
      for (const y of [b.y + 3, b.y + b.height - 3]) {
        expect(await button.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x!, y!)), [b.x + b.width / 2, y]), await button.innerText()).toBe(true);
      }
    }
    expect(await pane.evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('[data-choice-more]')).toHaveCount(0);
  };
  await expect(page.getByRole('button', { name: '戻る', exact: true })).toBeAttached();
  await expectAllInside();
  await expect(pane).toContainText('どの依頼のこと？（1/2）');
  await expect(page.getByRole('button', { name: 'かれ井戸の ぬし（井戸番と話す）' })).toBeVisible();
  if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/fixed-390.png` }); }
  await page.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(pane).toContainText('どの依頼のこと？（2/2）');
  await expect(page.getByRole('button', { name: '前へ', exact: true })).toBeVisible();
  await expectAllInside();
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page.getByText('会話終了')).toBeVisible();
});

test('320px で収まらない依頼は ▼ で知らせ、戻る は窓の下端に見えたまま', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4188/e2e/fixtures/quest-choices.html');
  const pane = page.locator('.aq-dialogue-pane').last();
  const back = page.getByRole('button', { name: '戻る', exact: true });
  await expect(back).toBeAttached();
  const frame = (await pane.boundingBox())!;
  const backAtBottom = async () => {
    const b = (await back.boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(frame.y + frame.height);
    expect(await back.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x!, y!)), [b.x + b.width / 2, b.y + b.height / 2])).toBe(true);
  };
  await backAtBottom();
  await expect(page.locator('[data-choice-more]')).toBeVisible();
  if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/fixed-320.png` }); }
  await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-choice-more]')).toHaveCount(0);
  await backAtBottom();
  const seed = (await page.getByRole('button', { name: /かれ井戸の たね/ }).boundingBox())!;
  expect(seed.y + seed.height).toBeLessThanOrEqual(frame.y + frame.height);
  await back.click();
  await expect(page.getByText('会話終了')).toBeVisible();
});
