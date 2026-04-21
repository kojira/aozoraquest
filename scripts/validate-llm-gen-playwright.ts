/**
 * scripts/validate-llm-gen-playwright.ts
 *
 * Playwright で Chromium (WebGPU 有効) を立ち上げ、LLM ハーネス HTML を
 * 複数 (モデル, dtype) で自動実行して結果を収集する。
 *
 * 前提: python3 -m http.server 8765 --bind 127.0.0.1 を scripts/ で起動済み
 *
 * 実行: pnpm tsx scripts/validate-llm-gen-playwright.ts
 * 出力: docs/data/llm-benchmark-browser-gen.md
 *
 * 永続コンテキスト (Chromium の IndexedDB) でモデルキャッシュを共有するので、
 * 2 回目以降の実行は高速。
 */

import { chromium, type BrowserContext } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HARNESS_URL = 'http://127.0.0.1:8765/validate-llm-gen-harness.html';
const USER_DATA_DIR = join(ROOT, '.cache/playwright-profile');
const LOAD_TIMEOUT_MS = 30 * 60 * 1000;  // 大型モデルの ONNX セッション初期化に 5〜20 分かかることを許容
const GEN_TIMEOUT_MS = 30 * 60 * 1000;

interface TestCase {
  modelId: string;
  dtype: string;
  note: string;
}

// TinySwallow 3 dtype を実 30 分タイムアウトで検証
const CASES: TestCase[] = [
  { modelId: 'onnx-community/TinySwallow-1.5B-Instruct-ONNX', dtype: 'q4f16', note: 'q4f16 (1.21GB)' },
  { modelId: 'onnx-community/TinySwallow-1.5B-Instruct-ONNX', dtype: 'int8',  note: 'int8 (1.56GB 単一)' },
  { modelId: 'onnx-community/TinySwallow-1.5B-Instruct-ONNX', dtype: 'q4',    note: 'q4 (1.77GB)' },
];

interface HarnessResult {
  status: 'ok' | 'error' | 'running';
  phase: string;
  logs: string[];
  webgpu: { supported: boolean; info?: any; reason?: string } | null;
  modelId: string;
  dtype: string;
  device: string;
  loadMs: number | null;
  results: Array<{
    label: string;
    latencyMs?: number;
    chars?: number;
    tokPerSec?: number;
    text?: string;
    error?: string;
  }>;
  error: string | null;
}

async function runCase(context: BrowserContext, c: TestCase): Promise<HarnessResult> {
  const page = await context.newPage();

  // ページ内コンソールをターミナルにも流す
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('ERROR') || text.includes('WARN') || text.length < 200) {
      console.log(`    [page] ${text.slice(0, 300)}`);
    }
  });

  // 失敗したリクエストをログ
  page.on('requestfailed', (req) => {
    console.log(`    [net FAIL] ${req.method()} ${req.url().slice(0, 120)}  — ${req.failure()?.errorText}`);
  });

  // ページクラッシュを検知
  page.on('crash', () => console.log(`    ❌ PAGE CRASHED`));
  page.on('pageerror', (err) => console.log(`    ❌ page error: ${err.message.slice(0, 200)}`));
  page.on('close', () => console.log(`    ℹ️  page closed`));

  const url = `${HARNESS_URL}?model=${encodeURIComponent(c.modelId)}&dtype=${encodeURIComponent(c.dtype)}&device=webgpu&maxtokens=80`;
  await page.goto(url, { waitUntil: 'load' });

  const waitStart = Date.now();
  const waitDeadlineLabel = new Date(waitStart + GEN_TIMEOUT_MS).toLocaleTimeString();
  console.log(`    timeout set to ${(GEN_TIMEOUT_MS / 60000).toFixed(0)} min (until ${waitDeadlineLabel})`);
  try {
    // NOTE: 3-arg form: (fn, arg, options). 2-arg の場合 options ではなく arg として扱われる
    await page.waitForFunction(
      () => (window as any).__DONE__ === true,
      undefined,
      { timeout: GEN_TIMEOUT_MS, polling: 1000 },
    );
    const elapsed = (Date.now() - waitStart) / 1000;
    console.log(`    __DONE__ seen after ${elapsed.toFixed(1)}s`);
  } catch (e) {
    const elapsed = (Date.now() - waitStart) / 1000;
    console.log(`    waitForFunction threw after ${elapsed.toFixed(1)}s: ${String(e).slice(0, 200)}`);
  }

  const result = await page.evaluate(() => (window as any).__RESULT__ as HarnessResult);
  await page.close();
  return result;
}

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function ms(v: number): string { return `${v.toFixed(0)}ms`; }
function s(v: number): string { return `${(v / 1000).toFixed(1)}s`; }

function render(allResults: HarnessResult[]): string {
  const lines: string[] = [];
  lines.push('# ブラウザ内 LLM 生成モデル ベンチマーク (Playwright + WebGPU)');
  lines.push('');
  lines.push(`- 生成: ${new Date().toISOString()}`);
  lines.push(`- 環境: Playwright Chromium (WebGPU)`);
  lines.push(`- ハーネス: \`scripts/validate-llm-gen-harness.html\``);
  lines.push(`- プロンプト 3 件 (春の空 / 朝の挨拶 / クエスト達成)`);
  lines.push('');

  // Summary
  lines.push('## サマリー');
  lines.push('');
  lines.push('| モデル | dtype | ロード | 生成 1件平均 | tok/s 平均 | 備考 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of allResults) {
    const sz = r.results.filter(x => x.latencyMs !== undefined);
    const avgLat = sz.length === 0 ? null : sz.reduce((s, x) => s + (x.latencyMs ?? 0), 0) / sz.length;
    const avgTps = sz.length === 0 ? null : sz.reduce((s, x) => s + (x.tokPerSec ?? 0), 0) / sz.length;
    const loadStr = r.loadMs === null ? '-' : s(r.loadMs);
    const latStr = avgLat === null ? '失敗' : s(avgLat);
    const tpsStr = avgTps === null ? '-' : `${avgTps.toFixed(1)} tok/s`;
    const note = r.status === 'error' ? `❌ ${r.phase}: ${r.error?.slice(0, 80)}` : '';
    lines.push(`| \`${r.modelId}\` | ${r.dtype} | ${loadStr} | ${latStr} | ${tpsStr} | ${note} |`);
  }
  lines.push('');

  // Per-model details
  for (const r of allResults) {
    lines.push(`## ${r.modelId} (${r.dtype})`);
    lines.push('');
    lines.push(`- status: **${r.status}** (${r.phase})`);
    if (r.webgpu) {
      lines.push(`- WebGPU: ${r.webgpu.supported ? '✓' : '✗'} ${JSON.stringify(r.webgpu.info ?? r.webgpu.reason)}`);
    }
    lines.push(`- ロード: ${r.loadMs === null ? '失敗' : s(r.loadMs)}`);
    if (r.error) {
      lines.push(`- エラー: \`${r.error}\``);
    }
    lines.push('');

    if (r.results.length > 0) {
      lines.push('### 生成結果');
      lines.push('');
      for (const gen of r.results) {
        lines.push(`#### ${gen.label}`);
        if (gen.error) {
          lines.push(`- エラー: ${gen.error}`);
        } else {
          lines.push(`- レイテンシ: ${s(gen.latencyMs ?? 0)} / ${gen.chars} 字 / ${gen.tokPerSec?.toFixed(1)} tok/s`);
          lines.push('');
          lines.push('```');
          lines.push((gen.text ?? '(空)').slice(0, 500));
          lines.push('```');
        }
        lines.push('');
      }
    }

    // Logs (excerpt)
    if (r.logs.length > 0) {
      lines.push('<details><summary>ハーネスログ</summary>');
      lines.push('');
      lines.push('```');
      lines.push(r.logs.slice(-40).join('\n'));
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }

  return lines.join('\n');
}

(async () => {
  mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log('Chromium 起動中 (WebGPU 有効)...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false, // WebGPU は headless でも動くがデバッグ容易性のため
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--disable-dawn-features=disallow_unsafe_apis',
    ],
  });

  const allResults: HarnessResult[] = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    console.log(`\n[${i + 1}/${CASES.length}] ${c.modelId} dtype=${c.dtype} (${c.note})`);
    try {
      const r = await runCase(context, c);
      allResults.push(r);
      console.log(`  → ${r.status} (phase: ${r.phase}, load: ${r.loadMs === null ? 'N/A' : (r.loadMs / 1000).toFixed(1) + 's'})`);
    } catch (e) {
      console.error(`  → runCase failed: ${e}`);
      allResults.push({
        status: 'error',
        phase: 'runCase-crashed',
        logs: [String(e)],
        webgpu: null,
        modelId: c.modelId,
        dtype: c.dtype,
        device: 'webgpu',
        loadMs: null,
        results: [],
        error: String(e),
      });
    }

    // 中間保存 (途中で落ちても結果が残るように)
    const md = render(allResults);
    const outPath = join(ROOT, 'docs/data/llm-benchmark-browser-gen.md');
    writeFileSync(outPath, md);
  }

  await context.close();
  console.log(`\n完了。詳細: docs/data/llm-benchmark-browser-gen.md`);
})().catch(e => {
  console.error('致命的エラー:', e);
  process.exit(1);
});
