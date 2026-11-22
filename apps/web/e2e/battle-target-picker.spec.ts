import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ねらう相手を選ぶ窓 (BattleTargetPicker) が 390px でスクロールなしに収まる (#1004)。
 * 見出しは出さず、行は枠なしの文字だけ。敵 2・3 体と、味方 4 人の回復を実測する。
 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4183, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.PICKER_SHOTS;

async function expectPickerFits(page: Page, names: string[], shotName: string) {
  await expect(page.getByText('だれを ねらう？')).toHaveCount(0);
  await expect(page.getByText('だれを かいふくする？')).toHaveCount(0);
  const back = page.locator('[data-picker-back]');
  const picker = back.locator('..');
  const backBox = (await back.boundingBox())!;
  for (const n of names) {
    const row = page.getByRole('button', { name: n, exact: true });
    const box = (await row.boundingBox())!;
    expect(box.y + box.height, `${n} が もどる にかくれる`).toBeLessThanOrEqual(backBox.y + 0.5);
    expect(box.height, `${n} のタップ高さ`).toBeGreaterThanOrEqual(36);
    const border = await row.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(border, `${n} に枠がある`).toBe('0px');
  }
  const backButton = back.getByRole('button', { name: 'もどる' });
  expect(await backButton.evaluate((el) => getComputedStyle(el).borderTopWidth), 'もどる に枠がある').toBe('0px');
  const { scrollH, clientH } = await picker.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(scrollH, '選ぶ窓があふれてスクロールが要る').toBeLessThanOrEqual(clientH);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, shotName) });
  }
}

for (const n of [2, 3]) {
  test(`敵 ${n} 体: たたかう → 相手の行と もどる がスクロールなしで収まる (390px)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:4183/e2e/fixtures/battle-target-picker.html?enemies=${n}`);
    await page.getByRole('button', { name: 'たたかう' }).click();
    await expectPickerFits(page, ['そらいろスライム', 'すなウサギ', 'もりのコウモリ'].slice(0, n), `picker-enemies-${n}.png`);
  });
}

test('味方 4 人: 聖光の癒し → 4 人と もどる がスクロールなしで収まる (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4183/e2e/fixtures/battle-target-picker.html?enemies=1&allies=4');
  await page.getByRole('button', { name: '聖光の癒し' }).click();
  await expectPickerFits(page, ['ゆうしゃ', 'カイト', 'ソラ', 'ミオ'], 'picker-allies-4.png');
});
