import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// /me の今の姿・目指す姿・診断結果カードで、ジョブ名の右に 4 文字型を半角括弧・空白なしで添える。
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: {
      'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'),
      'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/fixture-api'),
      'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:fixture.invalid'),
    }, server: { host: '127.0.0.1', port: 4186, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ viewport: { width: 390, height: 844 } });

test('/me はジョブ名の右に 4 文字型を「賢者(INTJ)」の形で出す', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { await route.abort(); return; }
    if (url.pathname.startsWith('/fixture-api/')) { await route.fulfill({ status: 404, json: {} }); return; }
    await route.continue();
  });
  await page.goto('http://127.0.0.1:4186/e2e/fixtures/me-job-type-code.html');
  const header = page.locator('p', { hasText: '今:' }).first();
  await expect(header).toContainText('賢者(INTJ)');
  await expect(header).toContainText('遠くを見通す戦略家');
  const target = page.locator('p', { hasText: '目指す:' });
  await expect(target).toContainText('吟遊詩人(ENTP)');
  await expect(target).toContainText('言葉で場を動かす即興家');
  await expect(page.locator('h3', { hasText: '今の姿:' })).toContainText('今の姿: 賢者(INTJ)');
  await expect(page.locator('body')).not.toContainText('MBTI');
  await page.screenshot({ path: testInfo.outputPath('me-390.png'), fullPage: false });
});
