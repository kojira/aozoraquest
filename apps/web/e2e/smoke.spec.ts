import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * 基本スモーク: 主要ルートがコンソールエラーを吐かずに描画される。
 * チャンク 404 / SPA fallback の MIME エラーが戻ったら即検知する。
 */
const ROUTES = ['/', '/onboarding', '/tos', '/privacy'];

for (const route of ROUTES) {
  test(`loads ${route} without console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // OAuth 未ログイン時の期待エラーは除外 (session fetch 401 等)
      if (/401|403|fetch.*failed|session restore failed/i.test(text)) return;
      // 実ネットワーク先の外部 (bsky.social) をブロックしてるケースもあり得るので
      // 同じく無視
      if (/bsky\.social|bsky\.app/.test(text)) return;
      // ローカル preview では aozoraquest.app の client-metadata.json を
      // cross-origin fetch して CORS エラーになる (本番では同一 origin)。
      // 環境差なので無視
      if (/aozoraquest\.app\/client-metadata\.json|CORS policy|ERR_FAILED/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (err) => {
      errors.push(`pageerror: ${err.message}`);
    });

    await page.goto(route);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    // 最低限、root に React がマウントされていること
    await expect(page.locator('#root')).toBeVisible();

    expect(errors, `unexpected errors on ${route}`).toEqual([]);
  });
}
