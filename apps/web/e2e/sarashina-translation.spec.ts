import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SARASHINA_BASE_URL } from '../src/lib/slm-wgsl/weights';

/**
 * Gemini Nano の無いブラウザ (= iOS / Android と同じ条件) で、召喚済みユーザーがブルスコンタブの儀式で sarashina を導入し、
 * 英語投稿が既存と同じ翻訳 UI で日本語になる。2 回目 (キャッシュ済み) は儀式なしで訳される。
 * キャッシュが消えたら翻訳時に勝手にダウンロードせず、翻訳 UI を消してタブの儀式ボタンを戻す。
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

test('Nano なし + WebGPU: ブルスコンタブの儀式で導入 → 英語投稿が訳される、キャッシュが消えても勝手に DL しない', async () => {
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

  // 2) 召喚済み・未導入のブルスコンタブ: 「召喚の儀式を始める」が出る。押すと儀式で導入し、出現して閉じる。PDS には書かない
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
  await page.goto(`${URL}?spirit`);
  const ritualButton = page.getByRole('button', { name: '召喚の儀式を始める' });
  await expect(ritualButton).toBeVisible({ timeout: 30_000 });
  expect(hits).toEqual([]);
  await shot('spirit-summoned-not-installed');
  await ritualButton.click();
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
  await expect(page.getByText('ブルスコン、あらわれた!')).toHaveCount(0, { timeout: 10_000 });
  await expect(ritualButton).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { pdsWrites: number }).pdsWrites)).toBe(0);
  expect(hits.filter((f) => f.startsWith('part-'))).toHaveLength(14);
  await shot('spirit-installed');

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

  // 4) 導入済みと判定した後でキャッシュが消えた: 翻訳ボタンを押しても取り直さず、翻訳 UI が消える
  hits.length = 0;
  await page.evaluate(() => new Promise<void>((resolve) => {
    localStorage.setItem('aozoraquest:autoTranslate', 'false');
    const req = indexedDB.deleteDatabase('aozoraquest-translations'); // 訳文キャッシュではなくモデルの読み込みを通す
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.goto(URL);
  await expect(page.getByText('🌐 翻訳する')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async (base) => { await (await caches.open('sarashina-wgsl-v1')).delete(`${base}/part-007.bin`); }, SARASHINA_BASE_URL);
  const notInstalled = page.waitForEvent('console', { predicate: (m) => m.text().includes('sarashina not installed'), timeout: 60_000 });
  await page.getByText('🌐 翻訳する').click();
  await notInstalled;
  await expect(page.getByText('🌐 翻訳中…')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('🌐 翻訳する')).toHaveCount(0);
  await expect(page.getByText('🌐 翻訳失敗')).toHaveCount(0);
  await expect(page.getByText('Just finished reading')).toBeVisible();
  expect(hits).toEqual([]);

  // 5) 再読み込みしても未導入のまま (翻訳 UI なし、取得なし)。ブルスコンタブには儀式ボタンが戻る
  await page.goto(URL);
  await page.waitForTimeout(1500);
  await expect(page.getByText('🌐 翻訳する')).toHaveCount(0);
  await page.goto(`${URL}?spirit`);
  await expect(ritualButton).toBeVisible({ timeout: 30_000 });
  expect(hits).toEqual([]);
  await context.close();
  await browser.close();
});
