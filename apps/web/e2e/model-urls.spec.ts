import { createHash } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import {
  COGNITIVE_WGSL_MODEL_BYTES,
  COGNITIVE_WGSL_MODEL_SHA256,
  COGNITIVE_WGSL_MODEL_URL,
  RURI_WGSL_MODEL_BYTES,
  RURI_WGSL_MODEL_SHA256,
  RURI_WGSL_MODEL_URL,
} from '../src/lib/cognitive-wgsl/weights';
import { SARASHINA_BASE_URL, SARASHINA_HEADER_SHA256 } from '../src/lib/slm-wgsl/weights';

/**
 * 公開先で使うモデル関連ファイルが実在することを確認。
 * 「HF Hub に upload 忘れた」「404 → SPA fallback HTML → クラッシュ」を
 * 事前に検知する。
 */
const COGNITIVE_REPO = 'kojira/aozoraquest-cognitive';
const COGNITIVE_SMALL_REPO = 'kojira/aozoraquest-cognitive-small';
const GENERATOR_REPO = 'onnx-community/TinySwallow-1.5B-Instruct-ONNX';

function hfUrl(repo: string, path: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${path}`;
}

/**
 * HF への HEAD を確認する。このテストの目的は「ファイルの実在確認」
 * (404 → SPA fallback HTML → クラッシュ の事前検知) であって、HF の
 * 可用性監視ではない。
 *
 * 429 (レート制限) や 5xx (一時的なサーバ側エラー) は「URL が間違って
 * いる/消えた」を意味しないので、これで CI を落とすのは誤検知。
 * CI の IP が HF にまとめてレート制限される (429) のは恒常的に起きるため、
 * transient 系は警告ログのみで skip し、404/401/403 等の本物の URL 不備
 * だけを失敗させる。
 */
async function expectReachable(
  api: Awaited<ReturnType<typeof request.newContext>>,
  url: string,
  label: string,
): Promise<void> {
  const res = await api.head(url, { maxRedirects: 5 });
  const status = res.status();
  if (status === 429 || status >= 500) {
    // eslint-disable-next-line no-console
    console.warn(`[model-urls] ${label}: HF が ${status} を返したため検証を skip (rate-limit/transient)`);
    return;
  }
  expect(status, label).toBeLessThan(400);
}

test.describe('HuggingFace model URLs are reachable', () => {
  for (const repo of [COGNITIVE_REPO, COGNITIVE_SMALL_REPO]) {
    test(`${repo}: config + tokenizer + onnx exist`, async () => {
      const api = await request.newContext();
      for (const f of ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx']) {
        await expectReachable(api, hfUrl(repo, f), `${repo}/${f}`);
      }
      await api.dispose();
    });
  }

  // WGSL 推論が読む重み (気質分類器 / Ruri 埋め込み)。HF の LFS/Xet は X-Linked-ETag に sha256、
  // X-Linked-Size に byte 数を返すので、コードに固定した値と同じファイルかまで確かめる。
  for (const [label, url, sha256, bytes] of [
    ['model.aqw', COGNITIVE_WGSL_MODEL_URL, COGNITIVE_WGSL_MODEL_SHA256, COGNITIVE_WGSL_MODEL_BYTES],
    ['ruri-v3-30m.aqw', RURI_WGSL_MODEL_URL, RURI_WGSL_MODEL_SHA256, RURI_WGSL_MODEL_BYTES],
  ] as const) {
    test(`WGSL weights (${label}) exist and match the pinned sha256`, async () => {
      const api = await request.newContext();
      const res = await api.head(url, { maxRedirects: 0 });
      const status = res.status();
      if (status === 429 || status >= 500) {
        // eslint-disable-next-line no-console
        console.warn(`[model-urls] ${label}: HF が ${status} を返したため検証を skip (rate-limit/transient)`);
      } else {
        expect(status, label).toBeLessThan(400);
        expect(res.headers()['x-linked-etag'], `${label} sha256`).toBe(`"${sha256}"`);
        expect(res.headers()['x-linked-size'], `${label} size`).toBe(String(bytes));
      }
      await api.dispose();
    });
  }

  // 翻訳用 sarashina (commit 固定)。header.json の sha256 をコードと照合し、header に載った各 part / tokenizer の
  // sha256・byte 数を HF の X-Linked-ETag / X-Linked-Size と照合する (= header と HF 上のファイルが同じもの)。
  test('sarashina WGSL weights: header matches the pinned sha256 and every part matches header', async () => {
    const api = await request.newContext();
    const res = await api.get(`${SARASHINA_BASE_URL}/header.json`);
    if (res.status() === 429 || res.status() >= 500) {
      // eslint-disable-next-line no-console
      console.warn(`[model-urls] sarashina header: HF が ${res.status()} を返したため検証を skip (rate-limit/transient)`);
      await api.dispose();
      return;
    }
    expect(res.status()).toBeLessThan(400);
    const body = await res.body();
    expect(createHash('sha256').update(body).digest('hex')).toBe(SARASHINA_HEADER_SHA256);
    const header = JSON.parse(body.toString('utf8')) as { parts: { file: string; bytes: number; sha256: string }[]; tokenizer: { file: string; bytes: number; sha256: string } };
    for (const f of [...header.parts, header.tokenizer, { file: 'LICENSE' }]) {
      const h = await api.head(`${SARASHINA_BASE_URL}/${f.file}`, { maxRedirects: 0 });
      if (h.status() === 429 || h.status() >= 500) continue;
      expect(h.status(), f.file).toBeLessThan(400);
      if (!('sha256' in f)) continue;
      if (/^"[0-9a-f]{64}"$/.test(h.headers()['x-linked-etag'] ?? '')) {
        expect(h.headers()['x-linked-etag'], `${f.file} sha256`).toBe(`"${f.sha256}"`);
        expect(h.headers()['x-linked-size'], `${f.file} size`).toBe(String(f.bytes));
      } else {
        // LFS 外 (tokenizer.json 3.6MB) は etag が git の blob sha (40 桁) なので中身を取って比べる
        const g = await api.get(`${SARASHINA_BASE_URL}/${f.file}`);
        expect(createHash('sha256').update(await g.body()).digest('hex'), `${f.file} sha256`).toBe(f.sha256);
      }
    }
    await api.dispose();
  });

  test(`${GENERATOR_REPO}: tokenizer + model (q4) exist`, async () => {
    const api = await request.newContext();
    for (const f of ['tokenizer.json', 'onnx/model_q4f16.onnx']) {
      await expectReachable(api, hfUrl(GENERATOR_REPO, f), `${GENERATOR_REPO}/${f}`);
    }
    await api.dispose();
  });
});
