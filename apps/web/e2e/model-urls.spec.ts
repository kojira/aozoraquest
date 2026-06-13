import { test, expect, request } from '@playwright/test';

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

  test(`${GENERATOR_REPO}: tokenizer + model (q4) exist`, async () => {
    const api = await request.newContext();
    for (const f of ['tokenizer.json', 'onnx/model_q4f16.onnx']) {
      await expectReachable(api, hfUrl(GENERATOR_REPO, f), `${GENERATOR_REPO}/${f}`);
    }
    await api.dispose();
  });
});
