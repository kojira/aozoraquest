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

test.describe('HuggingFace model URLs are reachable', () => {
  for (const repo of [COGNITIVE_REPO, COGNITIVE_SMALL_REPO]) {
    test(`${repo}: config + tokenizer + onnx exist`, async () => {
      const api = await request.newContext();
      for (const f of ['config.json', 'tokenizer.json', 'onnx/model_quantized.onnx']) {
        const res = await api.head(hfUrl(repo, f), { maxRedirects: 5 });
        expect(res.status(), `${repo}/${f}`).toBeLessThan(400);
      }
      await api.dispose();
    });
  }

  test(`${GENERATOR_REPO}: tokenizer + model (q4) exist`, async () => {
    const api = await request.newContext();
    for (const f of ['tokenizer.json', 'onnx/model_q4f16.onnx']) {
      const res = await api.head(hfUrl(GENERATOR_REPO, f), { maxRedirects: 5 });
      expect(res.status(), `${GENERATOR_REPO}/${f}`).toBeLessThan(400);
    }
    await api.dispose();
  });
});
