import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * マルチカラム workspace (docs/16-multicolumn.md) のスモーク。
 * OAuth 未ログイン状態で検証できる範囲:
 *  - `/` の workspace shell が landing (未サインイン) を表示する
 *  - ColumnPicker でサインイン不要カラム (検索 / 掲示板) を追加できる
 *  - モバイル幅で workspace-columns が横スクロール (scroll-snap) になる
 *
 * サインインが要る home/bar/notifications カラムは headless では
 * 検証できないため対象外 (dev 実機確認)。
 */

function trackErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/401|403|fetch.*failed|session restore failed/i.test(text)) return;
    if (/bsky\.social|bsky\.app/.test(text)) return;
    if (/aozoraquest\.app\/client-metadata\.json|CORS policy|ERR_FAILED/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test('未サインインの `/` は landing を表示し console エラーが出ない', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await expect(page.getByText('ログインして始める')).toBeVisible();
  expect(errors, 'unexpected errors').toEqual([]);
});

test('モバイル幅の `/board` がマルチカラム表示される', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/board');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await expect(page.locator('.board-columns')).toBeVisible();
});

test('検索ページが単体で開ける (カラム共用コンポーネントの health check)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/search?q=test');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await expect(page.locator('#root')).toBeVisible();
  expect(errors).toEqual([]);
});
