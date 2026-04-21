/**
 * scripts/validate-llm-cls-playwright.ts
 *
 * TinySwallow q4 で認知機能 (Ni/Ne/Si/Se/Ti/Te/Fi/Fe) のゼロショット分類を
 * 測定する。40 件のラベル付き投稿で Top-1 精度とレイテンシを計算し、
 * MiniLM (埋め込みベース) / Gemini (クラウド) と比較する。
 *
 * 実行: pnpm tsx scripts/validate-llm-cls-playwright.ts
 * 出力: docs/data/llm-benchmark-browser-cls.md
 */

import { chromium, type BrowserContext } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HARNESS_URL = 'http://127.0.0.1:8765/validate-llm-cls-harness.html';
const USER_DATA_DIR = join(ROOT, '.cache/playwright-profile');
const WAIT_TIMEOUT_MS = 30 * 60 * 1000;

interface CaseResult {
  idx: number;
  text: string;
  actual: string;
  predicted: string | null;
  rawText: string;
  latencyMs: number;
  ok: boolean;
}

interface Summary {
  total: number;
  correct: number;
  top1Accuracy: number;
  latency: { mean: number; p50: number; p95: number };
  confusion: Record<string, Record<string, number>>;
}

interface HarnessResult {
  status: 'ok' | 'error' | 'running';
  phase: string;
  logs: string[];
  modelId: string;
  dtype: string;
  device: string;
  loadMs: number | null;
  results: CaseResult[];
  summary: Summary | Record<string, never>;
  error: string | null;
}

interface TestCase {
  modelId: string;
  dtype: string;
}

const CASES: TestCase[] = [
  { modelId: 'onnx-community/TinySwallow-1.5B-Instruct-ONNX', dtype: 'q4' },
];

async function runCase(ctx: BrowserContext, c: TestCase): Promise<HarnessResult> {
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log(`    [page] ${msg.text().slice(0, 200)}`));
  page.on('pageerror', (err) => console.log(`    ❌ page error: ${err.message.slice(0, 200)}`));

  const url = `${HARNESS_URL}?model=${encodeURIComponent(c.modelId)}&dtype=${encodeURIComponent(c.dtype)}&device=webgpu`;
  await page.goto(url, { waitUntil: 'load' });

  const waitStart = Date.now();
  console.log(`    timeout ${(WAIT_TIMEOUT_MS / 60000).toFixed(0)} min set`);
  try {
    await page.waitForFunction(
      () => (window as any).__DONE__ === true,
      undefined,
      { timeout: WAIT_TIMEOUT_MS, polling: 1000 },
    );
    console.log(`    __DONE__ after ${((Date.now() - waitStart) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`    waitForFunction threw after ${((Date.now() - waitStart) / 1000).toFixed(1)}s: ${String(e).slice(0, 200)}`);
  }

  const result = await page.evaluate(() => (window as any).__RESULT__ as HarnessResult);
  await page.close();
  return result;
}

function render(all: HarnessResult[]): string {
  const lines: string[] = [];
  lines.push('# ブラウザ内 LLM 認知機能分類ベンチ (Playwright + WebGPU)');
  lines.push('');
  lines.push(`- 生成: ${new Date().toISOString()}`);
  lines.push(`- 方式: ゼロショット (LLM にプロンプトで 8 択を選ばせる、temperature=0)`);
  lines.push(`- テストセット: 40 件 (認知機能 8 × 5 件、docs/data/validation/cognitive_labeled.jsonl)`);
  lines.push('');

  // Summary
  lines.push('## サマリー');
  lines.push('');
  lines.push('| モデル | dtype | Top-1 精度 | 平均レイテンシ/件 | p95 | ロード |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of all) {
    const s = r.summary as Summary;
    const acc = s?.top1Accuracy !== undefined ? `${(s.top1Accuracy * 100).toFixed(1)}% (${s.correct}/${s.total})` : '失敗';
    const mean = s?.latency?.mean ? `${(s.latency.mean / 1000).toFixed(2)}s` : '-';
    const p95 = s?.latency?.p95 ? `${(s.latency.p95 / 1000).toFixed(2)}s` : '-';
    const load = r.loadMs ? `${(r.loadMs / 1000).toFixed(1)}s` : '-';
    lines.push(`| \`${r.modelId}\` | ${r.dtype} | ${acc} | ${mean} | ${p95} | ${load} |`);
  }
  lines.push('');
  lines.push('**参考**: MiniLM (埋め込み) Top-1 = 70%, Gemini v1 (クラウド) Top-1 = 95%');
  lines.push('');

  for (const r of all) {
    lines.push(`## ${r.modelId} (${r.dtype})`);
    lines.push('');
    if (r.status !== 'ok') {
      lines.push(`- ❌ ${r.phase}: ${r.error}`);
      lines.push('');
      continue;
    }
    const s = r.summary as Summary;

    // Confusion matrix
    lines.push('### 混同行列 (行=正解、列=予測)');
    lines.push('');
    const funcs = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];
    lines.push(`| 正解\\予測 | ${funcs.join(' | ')} |`);
    lines.push('|' + Array(funcs.length + 1).fill('---').join('|') + '|');
    for (const a of funcs) {
      const row = [a, ...funcs.map(b => String(s.confusion?.[a]?.[b] ?? 0))];
      lines.push(`| ${row.join(' | ')} |`);
    }
    lines.push('');

    // Per-sample
    lines.push('### サンプル別');
    lines.push('');
    lines.push('| # | 正解 | 予測 | 結果 | 投稿 | 速度 | 生出力 |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const x of r.results) {
      const okMark = x.ok ? '✓' : '✗';
      const raw = (x.rawText || '').slice(0, 80).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${x.idx + 1} | **${x.actual}** | ${x.predicted ?? '-'} | ${okMark} | ${x.text.replace(/\|/g, '\\|')} | ${(x.latencyMs / 1000).toFixed(1)}s | ${raw} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

(async () => {
  mkdirSync(USER_DATA_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });

  const all: HarnessResult[] = [];
  for (const c of CASES) {
    console.log(`\n${c.modelId} dtype=${c.dtype}`);
    const r = await runCase(ctx, c);
    all.push(r);
    console.log(`  → ${r.status} (Top-1 = ${(r.summary as any)?.top1Accuracy !== undefined ? ((r.summary as any).top1Accuracy * 100).toFixed(1) + '%' : 'N/A'})`);

    const md = render(all);
    writeFileSync(join(ROOT, 'docs/data/llm-benchmark-browser-cls.md'), md);
  }

  await ctx.close();
  console.log('完了。docs/data/llm-benchmark-browser-cls.md');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
