import { test, expect, devices } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Android (Pixel 7) でログイン直後、workspace が末尾の空カラム (＋ カラムを追加) ではなく
// 先頭カラムを表示する。OAuth callback → '/' と通常ロード '/' を fixture で再現する。
// 回帰: カラム読込前に末尾タイルだけ描画 → 先頭側へカラム挿入で scroll-snap が末尾へ追従していた。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'),
      'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: 4185, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

for (const [label, query] of [['ログイン直後 (OAuth callback)', '?code=fixture'], ['初回ロード (セッション復元)', '?entry=/']] as const) test(`Android: ${label} の workspace は先頭 (ホーム) カラムを表示する`, async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname.startsWith('/fixture-api/')) { await route.fulfill({ status: 404, json: {} }); return; }
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:4185/e2e/fixtures/workspace-login.html${query}`);
  const scroller = page.locator('.workspace-columns');
  await expect(page.locator('[data-column-kind="home"]')).toBeVisible();
  await page.waitForTimeout(1_000);
  const pos = await scroller.evaluate((el) => ({ left: el.scrollLeft, width: el.clientWidth, max: el.scrollWidth - el.clientWidth }));
  expect(pos.max).toBeGreaterThan(0);
  expect(pos.left).toBe(0);
  await expect(page.locator('[data-column-kind="home"]')).toBeInViewport({ ratio: 0.9 });
  await expect(page.getByRole('button', { name: '＋ カラムを追加' })).not.toBeInViewport();
});
