import { test, expect, chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { COGNITIVE_WGSL_MODEL_URL, RURI_WGSL_MODEL_URL } from '../src/lib/cognitive-wgsl/weights';

/**
 * 投稿の解析 / 診断 (日本語が足りない (c) の prototype 方式) / TL 気質分析 で onnxruntime を一切取りに行かない (#774)。
 * - 1 本目 (CI と同じ headless = WebGPU adapter なし): 投稿は成功し解析だけ飛ぶ。診断と TL は WebGPU 非対応のエラー。
 * - 2 本目 (WebGPU あり、AQ_WGSL_LOCAL_DIR に model.aqw と ruri-v3-30m.aqw がある時だけ): 3 経路が実際に推論まで通る。
 */
const PORT = 4285;
const URL = `http://127.0.0.1:${PORT}/e2e/fixtures/ml-paths.html`;
const LOCAL_DIR = process.env.AQ_WGSL_LOCAL_DIR;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    define: { 'import.meta.env.VITE_NSID_ENV': JSON.stringify('test'), 'import.meta.env.VITE_NSID_ROOT': JSON.stringify('app.aozoraquest'),
      'import.meta.env.VITE_EDGE_URL': JSON.stringify('/ml-fixture-api'), 'import.meta.env.VITE_EDGE_DID': JSON.stringify('did:web:ml.invalid') },
    // worker 内の import は依存スキャンに載らず、初回に再最適化 → ページ reload が起きるので先に入れる
    optimizeDeps: { entries: ['e2e/fixtures/ml-paths.tsx'], include: ['@huggingface/tokenizers'] },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

const ORT = /ort-wasm|onnxruntime|\.onnx(\?|$)/;
const ANALYSIS = 'app.aozoraquest.test.analysis';
const SEED = { archetype: 'sage', cognitiveScores: { Ni: 80, Ne: 40, Si: 30, Se: 20, Ti: 70, Te: 50, Fi: 30, Fe: 20 },
  rpgStats: { atk: 20, def: 20, agi: 20, int: 20, luk: 20 }, analyzedAt: '2026-10-01T00:00:00.000Z', confidence: 'high', analyzedPostCount: 100 };

async function open(context: BrowserContext) {
  const requests: string[] = [];
  context.on('request', (r) => requests.push(r.url()));
  await context.route('**/ml-fixture-api/**', (route) => route.fulfill({ json: { granted: 0, jobXp: 0 } }));
  const claims: unknown[] = [];
  context.on('request', (r) => { if (r.url().includes('/ml-fixture-api/api/xp/claim')) claims.push(r.postDataJSON()); });
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForFunction(() => (window as unknown as { mlPathsReady?: boolean }).mlPathsReady === true);
  return { page, requests, claims };
}
type Paths = { mlPaths: Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>> & { seedAnalysis: (c: string, v: unknown) => void } };

test('WebGPU なし: 投稿は成功して解析だけ飛ぶ・診断/TL は非対応エラー・ORT を取りに行かない', async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext();
  const { page, requests } = await open(context);
  expect(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))).toBe(false);
  await page.evaluate(([c, v]) => (window as unknown as Paths).mlPaths.seedAnalysis(c as string, v), [ANALYSIS, SEED] as const);
  const post = await page.evaluate(() => (window as unknown as Paths).mlPaths.post('今日は川沿いをゆっくり散歩して、気持ちのいい風に吹かれてきました。'));
  expect(post.action).toBeNull();
  expect(post.updatedCognitive).toBeNull();
  expect(post.keys).toContain(`app.aozoraquest.test.questLog/${new Date().toLocaleDateString('sv-SE')}`);
  const diag = await page.evaluate(() => (window as unknown as Paths).mlPaths.diagnose());
  expect(diag.ok).toBe(false);
  expect(String(diag.error)).toContain('WebGPU');
  const tl = await page.evaluate(() => (window as unknown as Paths).mlPaths.timeline('今日は川沿いをゆっくり散歩して、気持ちのいい風に吹かれてきました。'));
  expect(String(tl.error)).toContain('WebGPU');
  expect(requests.filter((u) => ORT.test(u))).toEqual([]);
  await context.close();
});

test('WebGPU あり (ローカル重み): 投稿・診断 (c)・TL が推論まで通り ORT を取りに行かない', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'ruri-v3-30m.aqw')), 'AQ_WGSL_LOCAL_DIR に model.aqw / ruri-v3-30m.aqw が無い');
  test.setTimeout(180_000);
  const gpuBrowser: Browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await gpuBrowser.newContext();
  for (const [url, file] of [[RURI_WGSL_MODEL_URL, 'ruri-v3-30m.aqw'], [COGNITIVE_WGSL_MODEL_URL, 'model.aqw']] as const) {
    await context.route(url, (route) => route.fulfill({ path: path.join(LOCAL_DIR!, file), contentType: 'application/octet-stream' }));
  }
  const { page, requests } = await open(context);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await page.evaluate(([c, v]) => (window as unknown as Paths).mlPaths.seedAnalysis(c as string, v), [ANALYSIS, SEED] as const);
  const post = await page.evaluate(() => (window as unknown as Paths).mlPaths.post('この仕様は根本から見直すべきだと思う。理由は三つある。'));
  expect(post.updatedCognitive).not.toBeNull();
  const diag = await page.evaluate(() => (window as unknown as Paths).mlPaths.diagnose());
  expect(diag).toMatchObject({ ok: true });
  // (c): 分類器の後 (analyzing) に prototype 方式の loading-prototypes が来る
  const phases = diag.phases as string[];
  expect(phases.indexOf('loading-prototypes', phases.indexOf('analyzing'))).toBeGreaterThan(0);
  const tl = await page.evaluate(() => (window as unknown as Paths).mlPaths.timeline('今日は川沿いをゆっくり散歩して、気持ちのいい風に吹かれてきました。'));
  expect(tl).toMatchObject({ ok: true });
  expect(requests.some((u) => u.includes('ruri-v3-30m.aqw'))).toBe(true); // 2 回目以降は Cache API から読む
  expect(requests.filter((u) => ORT.test(u))).toEqual([]);
  console.log('[ml-paths] requests', JSON.stringify([...new Set(requests.map((u) => u.split('?')[0]))].filter((u) => !u.includes('127.0.0.1'))));
  await gpuBrowser.close();
});

test('WebGPU あり・Ruri の重みが取れない (404): 投稿は questLog と XP 申告まで進み、解析だけ飛ぶ', async () => {
  test.setTimeout(120_000);
  const gpuBrowser: Browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await gpuBrowser.newContext();
  await context.route(RURI_WGSL_MODEL_URL, (route) => route.fulfill({ status: 404, body: 'Entry not found' }));
  const { page, requests, claims } = await open(context);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await page.evaluate(([c, v]) => (window as unknown as Paths).mlPaths.seedAnalysis(c as string, v), [ANALYSIS, SEED] as const);
  const post = await page.evaluate(() => (window as unknown as Paths).mlPaths.post('この仕様は根本から見直すべきだと思う。理由は三つある。'));
  expect(post).toMatchObject({ action: null, updatedCognitive: null });
  expect(post.keys).toContain(`app.aozoraquest.test.questLog/${new Date().toLocaleDateString('sv-SE')}`);
  expect(claims).toEqual([{ archetype: 'sage', postUri: 'at://did:plc:mlpaths/app.bsky.feed.post/1' }]);
  expect(requests.some((u) => u.includes('ruri-v3-30m.aqw'))).toBe(true);
  await gpuBrowser.close();
});
