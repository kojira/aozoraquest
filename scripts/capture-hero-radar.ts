/**
 * README ヒーロー画像の 2 枚目 (レーダーチャート) を生成。
 * /debug/radar ルートを開いて、kojira の analysis レコードから 5 ステータス
 * (攻 / 守 / 速 / 知 / 運) を取得・描画 → SVG を PNG 化して docs/hero-radar.png に保存。
 *
 * vite dev (localhost:9999) が事前に起動している前提。
 *   pnpm tsx scripts/capture-hero-radar.ts
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/hero-radar.png');
const DEV_BASE = process.env.DEV_BASE ?? 'http://localhost:9999';

const HANDLE = 'kojira.io';

async function main() {
  const url = new URL('/debug/radar', DEV_BASE);
  url.searchParams.set('handle', HANDLE);

  console.log(`[capture] launching playwright → ${url.toString()}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(url.toString(), { waitUntil: 'networkidle' });

  await page.waitForFunction(() => {
    return (window as unknown as { __radarReady?: boolean }).__radarReady === true;
  }, undefined, { timeout: 15000 });

  // ラベル (「攻 23」等) は SVG viewBox 外にはみ出すので、外側に余白を持つ
  // wrap div (data-hero-radar="1") を撮る。
  const wrap = page.locator('[data-hero-radar="1"]').first();
  await wrap.waitFor({ state: 'visible' });
  const buf = await wrap.screenshot({ type: 'png', omitBackground: true });

  await writeFile(OUT, buf);
  console.log(`[capture] saved → ${OUT}  (${buf.byteLength} bytes)`);

  await browser.close();

  const quant = spawnSync('pngquant', ['--force', '--quality', '70-90', '--strip', '--skip-if-larger', '--output', OUT, OUT], { stdio: 'inherit' });
  if (quant.status === 0) {
    const fs = await import('node:fs/promises');
    const stat = await fs.stat(OUT);
    console.log(`[capture] pngquant → ${stat.size} bytes`);
  } else {
    console.log('[capture] pngquant not available or no gain (skipped)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
