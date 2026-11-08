import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SLM_BASE_URL } from '../src/lib/slm-wgsl/weights';

/**
 * Gemini Nano の無いブラウザ (= iOS / Android と同じ条件) のカード画面 (D-SLM-CARD-001 PR3):
 * 未導入なら「精霊タブの『召喚の儀式』でブルスコンを呼び出すと引けます。」→ 精霊タブで呼び出す → カード画面で初回のカードが書かれる
 * → 「引き直す」でパックが開いてカードが出る (5 回)。どれもブルスコンの 4 行方式で書かれ、取得は導入の時だけ。
 * WebGPU と重み (AQ_SLM_LOCAL_DIR) が要るので CI では skip。
 */
const PORT = 4288;
const URL = `http://127.0.0.1:${PORT}/e2e/fixtures/slm-translation.html`;
const LOCAL_DIR = process.env.AQ_SLM_LOCAL_DIR;
const SHOTS = process.env.SLM_SHOTS;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    optimizeDeps: { entries: ['e2e/fixtures/slm-translation.tsx'], include: ['react-dom/client'] },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('Nano なし + WebGPU: 未導入の案内 → 呼び出し → カードを 5 回引ける', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SLM_LOCAL_DIR に重みが無い');
  test.setTimeout(400_000);
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const hits: string[] = [];
  await context.route(`${SLM_BASE_URL}/**`, async (route) => {
    const file = route.request().url().split('/').pop()!;
    hits.push(file);
    return route.fulfill({ body: readFileSync(path.join(LOCAL_DIR!, file)), headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await context.newPage();
  const fourLine: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[card-text/four-line]')) fourLine.push(t);
    if (m.type() === 'warning' || m.type() === 'error') console.log('[page]', t.slice(0, 300));
  });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); };

  // 1) 未導入: 案内文、引き直しは押せない、カードは書かれない
  await page.goto(`${URL}?card`);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await expect(page.getByText('精霊タブの『召喚の儀式』でブルスコンを呼び出すと引けます。')).toBeVisible({ timeout: 30_000 });
  await shot('card-not-installed');
  expect(hits).toEqual([]);

  // 2) 精霊タブで呼び出す
  await page.goto(`${URL}?spirit`);
  await page.getByRole('button', { name: '召喚の儀式を始める' }).click();
  await page.getByRole('button', { name: '呼び出して始める' }).click();
  await expect(page.getByText('ブルスコン、あらわれた!')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByRole('button', { name: '召喚の儀式を始める' })).toHaveCount(0, { timeout: 15_000 });
  hits.length = 0;

  // 3) カード画面: 初回のカードが演出なしで書かれる (4 行方式)
  await page.goto(`${URL}?card`);
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { savedCard?: unknown }).savedCard), { timeout: 120_000 }).toBe(true);
  const first = await page.evaluate(() => (window as unknown as { savedCard: Record<string, unknown> }).savedCard);
  console.log('[card] initial', first.cardName, '/', first.cardEffectName, '/', first.cardEffectDescription, '/', first.flavorText);
  expect(fourLine.some((t) => t.includes('type='))).toBe(true);

  // 4) 「引き直す」を 5 回: 毎回パックが開いてカードが出る
  const redraw = page.getByRole('button', { name: /引き直す/ });
  const seconds: number[] = [];
  for (let i = 0; i < 5; i++) {
    await expect(redraw).toBeEnabled({ timeout: 60_000 });
    const before = await page.evaluate(() => (window as unknown as { pdsWrites: number }).pdsWrites);
    const t0 = Date.now();
    await redraw.click();
    await expect(page.locator('.cp-overlay')).toBeVisible();
    if (i === 0) { await page.waitForTimeout(1800); await shot('card-drawing'); }
    await expect.poll(() => page.evaluate(() => (window as unknown as { pdsWrites: number }).pdsWrites), { timeout: 60_000 }).toBeGreaterThan(before);
    seconds.push((Date.now() - t0) / 1000);
    await expect(page.locator('.cp-overlay')).toHaveCount(0, { timeout: 40_000 });
    const c = await page.evaluate(() => (window as unknown as { savedCard: Record<string, unknown> }).savedCard);
    console.log(`[card] draw ${i + 1}`, c.cardType, '/', c.cardName, '/', c.cardEffectName, '/', c.cardEffectDescription, '/', c.flavorText);
  }
  console.log('[card] seconds to saved', seconds.join(', '));
  await shot('card-drawn');
  expect(hits.filter((f) => f.startsWith('part-'))).toEqual([]);
  console.log('[card] four-line log', fourLine.filter((t) => t.includes('rejected')).length, 'rejected attempts');
  await context.close();
  await browser.close();
});
