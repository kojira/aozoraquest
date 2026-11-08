import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/** 仲間の回復 (D-PARTY-003) の 390px の見た目: 戦闘の「だれを かいふくする？」と、フィールドの「とくぎ」→ 結果。 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4181, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.ALLY_HEAL_SHOTS;
const shot = async (page: import('@playwright/test').Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
};

test('戦闘: 聖光の癒しで 生きている味方から選び、選んだ番号を送る (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4181/e2e/fixtures/ally-heal.html?view=battle');
  await page.getByRole('button', { name: '聖光の癒し' }).click();
  await expect(page.getByText('だれを かいふくする？')).toBeVisible();
  for (const n of ['ゆうしゃ', 'カイト']) await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ソラ', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'もどる' })).toBeInViewport();
  await shot(page, 'battle-ally-heal-picker.png');
  await page.getByRole('button', { name: 'カイト', exact: true }).click();
  await expect(page.getByTestId('sent')).toContainText('"targetIndex":1');
});

test('フィールド: メニューの「とくぎ」→ ハル → 聖光の癒し → ゆうしゃ → 結果 (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4181/e2e/fixtures/ally-heal.html?view=field');
  await expect(page.getByRole('button', { name: 'とくぎ' })).toBeVisible();
  await shot(page, 'field-menu-tokugi.png');
  await page.getByRole('button', { name: 'とくぎ' }).click();
  await expect(page.getByText('だれが となえる？')).toBeVisible();
  await shot(page, 'field-skill-caster.png');
  await page.getByRole('button', { name: 'えらぶ' }).first().click();
  await page.getByRole('button', { name: 'となえる' }).first().click();
  await expect(page.getByText('だれを かいふくする？')).toBeVisible();
  await shot(page, 'field-skill-target.png');
  await page.getByRole('button', { name: 'かいふく' }).first().click();
  await expect(page.getByText('ハルは 聖光の癒しを となえた！ ゆうしゃの HPが 9 かいふくした。')).toBeVisible();
  await shot(page, 'field-skill-result.png');
});
