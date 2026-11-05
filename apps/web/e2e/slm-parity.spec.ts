import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { SLM_BASE_URL } from '../src/lib/slm-wgsl/weights';

/**
 * アプリの slm-wgsl (WebGPU) で LFM2.5-1.2B-JP を動かし、HF int4 fake-quant 参照の greedy 生成と EOS まで全トークン一致するか確かめる。
 * 参照は src/lib/slm-wgsl/lfm-tokenizer.fixture.json の 4 プロンプト (翻訳 2 件・ブルスコン・カード (c) の 1 件)。
 * WebGPU と重み (AQ_SLM_LOCAL_DIR = HF の wgsl/lfm2.5-1.2b-jp-q4 と同じ中身) が要るので CI では skip。
 */
const PORT = 4287;
const URL = `http://127.0.0.1:${PORT}/e2e/fixtures/slm-parity.html`;
const LOCAL_DIR = process.env.AQ_SLM_LOCAL_DIR;
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), optimizeDeps: { entries: ['e2e/fixtures/slm-parity.ts'] },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

test('LFM2.5 の WGSL greedy 生成が HF int4 参照と EOS まで一致する', async () => {
  test.skip(!LOCAL_DIR || !existsSync(path.join(LOCAL_DIR, 'header.json')), 'AQ_SLM_LOCAL_DIR に重みが無い');
  test.setTimeout(300_000);
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext();
  await context.route(`${SLM_BASE_URL}/**`, (route) => route.fulfill({
    body: readFileSync(path.join(LOCAL_DIR!, route.request().url().split('/').pop()!)),
    headers: { 'access-control-allow-origin': '*' },
  }));
  const page = await context.newPage();
  await page.goto(URL);
  test.skip(!(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))), 'WebGPU adapter が無い');
  await page.waitForFunction(() => {
    const w = window as unknown as { parity?: unknown; parityError?: string };
    return w.parity !== undefined || w.parityError !== undefined;
  }, undefined, { timeout: 240_000 });
  const { parity, parityError } = await page.evaluate(() => {
    const w = window as unknown as { parity?: { ids: number[]; ref: number[] }[]; parityError?: string };
    return { parity: w.parity, parityError: w.parityError };
  });
  expect(parityError).toBeUndefined();
  expect(parity).toHaveLength(4);
  for (const [i, r] of parity!.entries()) {
    console.log(`[parity] prompt ${i}: ${r.ids.length}/${r.ref.length} tokens`);
    expect(r.ids, `prompt ${i}`).toEqual(r.ref);
  }
  await context.close();
  await browser.close();
});
