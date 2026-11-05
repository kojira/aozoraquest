import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { SLM_BASE_URL } from '../src/lib/slm-wgsl/weights';

/**
 * Gemini Nano の無いブラウザ (= iOS / Android と同じ条件) で、召喚済みユーザーが精霊タブの儀式で確認シートを承諾してブルスコン (LFM2.5) を導入し、
 * 英語投稿が既存と同じ翻訳 UI で日本語になる (D-SLM-CARD-001 PR2)。
 * - 「今はやめる」は閉じるだけで、何も取得しない。
 * - 導入中は儀式の hint に MB の進捗が出る。導入後は sarashina のキャッシュを消し、分類・埋め込み・tokenizer・知らないキャッシュは残す。
 * - キャッシュが消えたら翻訳時に勝手にダウンロードせず、翻訳 UI を消して精霊タブの儀式ボタンを戻す。
 * WebGPU と重み (AQ_SLM_LOCAL_DIR = HF の wgsl/lfm2.5-1.2b-jp-q4 と同じ中身) が要るので CI では skip。
 */
const PORT = 4286;
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

async function serveLocalWeights(context: BrowserContext, hits: string[]) {
  await context.route(`${SLM_BASE_URL}/**`, async (route) => {
    const file = route.request().url().split('/').pop()!;
    hits.push(file);
    // スクショ時だけ part ごとに遅らせて、実回線のように MB の進捗を見せる
    if (SHOTS && file.startsWith('part-')) await new Promise((r) => setTimeout(r, 700));
    return route.fulfill({ body: readFileSync(path.join(LOCAL_DIR!, file)), headers: { 'access-control-allow-origin': '*' } });
  });
}

/** 他のキャッシュ (sarashina = 消す、分類・埋め込み・tokenizer・知らないもの = 残す) を置いておく。 */
async function seedOtherCaches(page: Page) {
  await page.evaluate(async () => {
    for (const name of ['sarashina-wgsl-v1', 'cognitive-wgsl-v1', 'transformers-cache', 'someone-else']) {
      await (await caches.open(name)).put(`https://example.invalid/${name}`, new Response('x'));
    }
  });
}

test('Nano なし + WebGPU: 確認シート → 儀式でブルスコンを導入 → 英語投稿が訳される、キャッシュが消えても勝手に DL しない', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SLM_LOCAL_DIR に重みが無い');
  test.setTimeout(300_000);
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const hits: string[] = [];
  await serveLocalWeights(context, hits);
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };

  // 1) 未導入: 翻訳 UI は出ない (Nano の無い端末の今と同じ)
  await page.goto(URL);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  expect(await page.evaluate(() => typeof (window as unknown as { LanguageModel?: unknown }).LanguageModel)).toBe('undefined');
  await seedOtherCaches(page);
  await expect(page.getByText('Just finished reading')).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByText('🌐 翻訳する')).toHaveCount(0);

  // 2) 召喚済み・未導入の精霊タブ: 「召喚の儀式を始める」→ 確認シート。「今はやめる」は閉じるだけ
  await page.goto(`${URL}?spirit`);
  const ritualButton = page.getByRole('button', { name: '召喚の儀式を始める' });
  await expect(ritualButton).toBeVisible({ timeout: 30_000 });
  await ritualButton.click();
  const sheet = page.getByRole('dialog', { name: 'ブルスコンを呼び出す' });
  await expect(sheet.getByText('この端末にブルスコンを呼び出します（約660MB）。カードを引く・投稿を訳すのに使います。Wi-Fi でのダウンロードをおすすめします。')).toBeVisible();
  await shot('sheet');
  await sheet.getByRole('button', { name: '今はやめる' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('青空の気配が集まる…')).toHaveCount(0);
  expect(hits).toEqual([]);

  // 3) 「呼び出して始める」: 儀式の間に受け取り、hint に MB の進捗が出る。出現して閉じる。PDS には書かない
  await ritualButton.click();
  await page.getByRole('button', { name: '呼び出して始める' }).click();
  await expect(page.getByText('青空の気配が集まる…')).toBeVisible();
  const progress = page.getByText(/^ブルスコンを呼び出し中 \d+ \/ 659 MB$/);
  await expect(progress).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(SHOTS ? 3000 : 0);
  await shot('ritual-progress');
  await expect(page.getByText('ブルスコン、あらわれた!')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText('ブルスコン、あらわれた!')).toHaveCount(0, { timeout: 10_000 });
  await expect(ritualButton).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { pdsWrites: number }).pdsWrites)).toBe(0);
  expect(hits.filter((f) => f.startsWith('part-'))).toHaveLength(20);
  expect((await page.evaluate(() => caches.keys())).sort()).toEqual(['cognitive-wgsl-v1', 'slm-wgsl-v1', 'someone-else', 'transformers-cache']);

  // 4) 導入済み: 投稿は自動翻訳設定 (既定 ON) で「翻訳中…」→ 訳文。ダウンロードは起きない
  hits.length = 0;
  await page.goto(URL);
  await expect(page.getByText('🌐 訳文を表示中')).toBeVisible({ timeout: 60_000 });
  const translated = await page.locator('body').innerText();
  console.log('[translated]', translated.split('\n').slice(0, 3).join(' / '));
  expect(translated).not.toContain('Just finished reading');
  expect(translated).toMatch(/[ぁ-んァ-ン一-龥]{6,}/);
  expect(hits.filter((f) => f.startsWith('part-'))).toEqual([]);
  await shot('translated-post');

  // 5) 導入済みと判定した後でキャッシュが消えた: 翻訳ボタンを押しても取り直さず、翻訳 UI が消える
  hits.length = 0;
  await page.evaluate(() => new Promise<void>((resolve) => {
    localStorage.setItem('aozoraquest:autoTranslate', 'false');
    const req = indexedDB.deleteDatabase('aozoraquest-translations'); // 訳文キャッシュではなくモデルの読み込みを通す
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.goto(URL);
  await expect(page.getByText('🌐 翻訳する')).toBeVisible({ timeout: 30_000 });
  await page.evaluate(async (base) => { await (await caches.open('slm-wgsl-v1')).delete(`${base}/part-007.bin`); }, SLM_BASE_URL);
  const notInstalled = page.waitForEvent('console', { predicate: (m) => m.text().includes('slm not installed'), timeout: 60_000 });
  await page.getByText('🌐 翻訳する').click();
  await notInstalled;
  await expect(page.getByText('🌐 翻訳中…')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('🌐 翻訳する')).toHaveCount(0);
  await expect(page.getByText('🌐 翻訳失敗')).toHaveCount(0);
  expect(hits).toEqual([]);

  // 6) 再読み込みしても未導入のまま。精霊タブには儀式ボタンが戻る
  await page.goto(`${URL}?spirit`);
  await expect(ritualButton).toBeVisible({ timeout: 30_000 });
  expect(hits).toEqual([]);

  // 7) プライバシーポリシーの文言とクレジット
  await page.goto(`${URL}?privacy`);
  await expect(page.getByText('端末内で動くブルスコン（言語モデル LFM2.5-1.2B-JP、初回のみ約660MB をダウンロード）', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'LFM Open License v1.0' })).toHaveAttribute('href', `${SLM_BASE_URL}/LICENSE`);
  await shot('privacy-credit');
  await context.close();
  await browser.close();
});

test('空きが足りない端末では始めずに文言を出す', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SLM_LOCAL_DIR に重みが無い');
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const hits: string[] = [];
  await serveLocalWeights(context, hits);
  await context.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'estimate', { value: async () => ({ quota: 500_000_000, usage: 0 }) });
  });
  const page = await context.newPage();
  await page.goto(`${URL}?spirit`);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await page.getByRole('button', { name: '召喚の儀式を始める' }).click();
  await page.getByRole('button', { name: '呼び出して始める' }).click();
  await expect(page.getByText('端末の空きが足りないため、ブルスコンを呼び出せませんでした。')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'sheet-storage-full.png') });
  await page.getByRole('button', { name: 'とじる' }).click();
  await expect(page.getByText('青空の気配が集まる…')).toHaveCount(0);
  expect(hits).toEqual([]);
  await context.close();
  await browser.close();
});

test('召喚前に「今はやめる」: ダウンロードせず、手書きの口上で儀式を終える', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SLM_LOCAL_DIR に重みが無い');
  test.setTimeout(120_000);
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const hits: string[] = [];
  await serveLocalWeights(context, hits);
  const page = await context.newPage();
  await page.goto(`${URL}?spirit&unsummoned`);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await page.getByRole('button', { name: '召喚の儀式を始める' }).click();
  await page.getByRole('button', { name: '今はやめる' }).click();
  await expect(page.getByText('青空の気配が集まる…')).toBeVisible();
  await expect(page.getByText('ブルスコン、あらわれた!')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { pdsWrites: number }).pdsWrites), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(hits).toEqual([]);
  await context.close();
  await browser.close();
});
