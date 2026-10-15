import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SARASHINA_BASE_URL } from '../src/lib/slm-wgsl/weights';

/**
 * Gemini Nano の無いブラウザ (= iOS / Android と同じ条件) で、召喚の儀式中に sarashina を導入し、
 * 英語投稿が既存と同じ翻訳 UI で日本語になる。2 回目 (キャッシュ済み) は儀式なしで訳される。
 * WebGPU と重み (AQ_SARASHINA_LOCAL_DIR = HF の wgsl/sarashina2.2-0.5b-q4 と同じ中身) が要るので CI では skip。
 */
const PORT = 4286;
const URL = `http://127.0.0.1:${PORT}/e2e/fixtures/sarashina-translation.html`;
const LOCAL_DIR = process.env.AQ_SARASHINA_LOCAL_DIR;
const SHOTS = process.env.SARASHINA_SHOTS;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    optimizeDeps: { entries: ['e2e/fixtures/sarashina-translation.tsx'], include: ['react-dom/client'] },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

async function serveLocalWeights(context: BrowserContext, hits: string[]) {
  await context.route(`${SARASHINA_BASE_URL}/**`, async (route) => {
    const file = route.request().url().split('/').pop()!;
    hits.push(file);
    // スクショ時だけ part ごとに遅らせて、実回線のように待ち (ナレーション巡回・20 秒後の添え書き) を見せる
    if (SHOTS && file.startsWith('part-')) await new Promise((r) => setTimeout(r, 2000));
    return route.fulfill({ body: readFileSync(path.join(LOCAL_DIR!, file)), headers: { 'access-control-allow-origin': '*' } });
  });
}

test('Nano なし + WebGPU: 儀式で導入 → 英語投稿が訳される、2 回目は儀式なし', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SARASHINA_LOCAL_DIR に重みが無い');
  test.setTimeout(300_000);
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const hits: string[] = [];
  await serveLocalWeights(context, hits);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });

  // 1) 未導入: 翻訳 UI は出ない (Nano の無い端末の今と同じ)
  await page.goto(URL);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  expect(await page.evaluate(() => typeof (window as unknown as { LanguageModel?: unknown }).LanguageModel)).toBe('undefined');
  await expect(page.getByText('Just finished reading')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByText('🌐 翻訳する')).toHaveCount(0);
  await expect(page.getByText('🌐 翻訳中…')).toHaveCount(0);

  // 2) 召喚の儀式: 導入が済むまで待ってから出現。口上は手書き固定文のまま
  await page.goto(`${URL}?ritual`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  await expect(page.getByText('青空の気配が集まる…')).toBeVisible();
  await page.waitForTimeout(1200); await shot('ritual-1-gathering');
  await expect(page.getByText('光の中に、形が見えてきた…')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200); await shot('ritual-2-forming');
  await expect(page.getByText('まぶたがゆっくりと開いていく…')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(1200); await shot('ritual-3-awakening');
  if (SHOTS) {
    await expect(page.getByText('名乗りの言葉を、ブルスコンが紡いでいる…')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1200); await shot('ritual-4-greeting');
    await expect(page.getByText('もう少しで姿が現れる')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800); await shot('ritual-4b-hint');
  }
  await expect(page.getByText('ブルスコン、あらわれた!')).toBeVisible({ timeout: 240_000 });
  await page.waitForTimeout(250); await shot('ritual-5-emerging');
  await page.waitForFunction(() => (window as unknown as { ritualDone?: boolean }).ritualDone === true, undefined, { timeout: 10_000 });
  await expect(page.getByTestId('welcome')).toHaveText('呼んでくれて、ありがとう、テスト。ここにいる。');
  expect(hits.filter((f) => f.startsWith('part-'))).toHaveLength(14);

  // 3) 導入済み: 投稿は自動翻訳設定 (既定 ON) で「翻訳中…」→ 訳文。ダウンロードは起きない
  hits.length = 0;
  await page.goto(URL);
  await expect(page.getByText('🌐 訳文を表示中')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('原文を見る')).toBeVisible();
  const translated = await page.locator('body').innerText();
  console.log('[translated]', translated.split('\n').slice(0, 3).join(' / '));
  expect(translated).not.toContain('Just finished reading');
  expect(translated).toMatch(/[ぁ-んァ-ン一-龥]{6,}/);
  expect(hits.filter((f) => f.startsWith('part-'))).toEqual([]);
  await shot('translated-post');
  await page.getByText('原文を見る').click();
  await expect(page.getByText('Just finished reading')).toBeVisible();
  await context.close();
  await browser.close();
});
