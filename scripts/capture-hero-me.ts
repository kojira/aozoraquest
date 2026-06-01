/**
 * README ヒーロー画像の 3 枚目 (me ページ全体) を生成。
 * /debug/me ルートを開いて、kojira の analysis + profile を public API から
 * 取得・me 相当の見た目で描画 → wrap div を PNG 化して docs/hero-me.png に保存。
 *
 * vite dev (localhost:9999) が事前に起動している前提。
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/hero-me.png');
const DEV_BASE = process.env.DEV_BASE ?? 'http://localhost:9999';
const HANDLE = 'kojira.io';

async function main() {
  const url = new URL('/debug/me', DEV_BASE);
  url.searchParams.set('handle', HANDLE);

  console.log(`[capture] launching playwright → ${url.toString()}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    deviceScaleFactor: 2,
    // 縦長スクショ用に viewport を高めに (Bluesky avatar の遅延ロードを避けたいので)
    viewport: { width: 720, height: 1600 },
  });
  const page = await ctx.newPage();
  await page.goto(url.toString(), { waitUntil: 'networkidle' });

  await page.waitForFunction(() => {
    return (window as unknown as { __meReady?: boolean }).__meReady === true;
  }, undefined, { timeout: 15000 });

  // CSS background image (avatar) が読み終わるのを待つために少し余裕を取る
  await page.waitForTimeout(800);

  const wrap = page.locator('[data-hero-me="1"]').first();
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
