/**
 * README ヒーロー画像用に、debug-card route の JobCard を PNG として保存するスクリプト。
 *
 * vite dev (127.0.0.1:9999) が事前に起動している前提。playwright で /debug/card を開き、
 * URL パラメータでカード内容を指定 → SVG が描画されたら window.__cardSvg 経由で
 * cardToPngBlob 相当の処理を行って PNG を取り出す。
 *
 * 実行: pnpm --filter @aozoraquest/web dev で server 起動後、別ターミナルから
 *       pnpm tsx scripts/capture-hero-card.ts
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/hero-card.png');
const DEV_BASE = process.env.DEV_BASE ?? 'http://127.0.0.1:9999';

const HANDLE = 'kojira.io';
// kojira の hero カード設定。実際の引き直しと違って固定なので、README が陳腐化
// しにくい中庸な内容にする (ぶっ飛び過ぎず、地味すぎず)。
const PARAMS = {
  handle: HANDLE,
  archetype: 'ninja',
  rarity: 'srare',
  cardType: 'creature',
  cardName: '夜更けの編集者',
  effectName: '潜影',
  effectDescription: '登場時、対象アカウントの直近 3 件をあなたのフィードに引き寄せる。',
  flavor: 'kojira は、まだ言葉になっていない投稿を編集している。誰も気づかぬまま、世界はそっと書き換わっている。',
  flavorAttr: 'ひでお',
  manaCost: JSON.stringify({ U: 1, B: 1, generic: 1 }),
  abilityCost: 'null',
  keywords: '飛行,警戒',
  power: '3',
  toughness: '3',
};

async function main() {
  const url = new URL('/debug/card', DEV_BASE);
  for (const [k, v] of Object.entries(PARAMS)) url.searchParams.set(k, v);

  console.log(`[capture] launching playwright → ${url.toString()}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(url.toString(), { waitUntil: 'networkidle' });

  // debug-card 側で SVG + avatar inline 完了で立てる __cardReady フラグを待つ。
  // waitForTimeout で待っていた以前の実装は flaky だった。
  await page.waitForFunction(() => {
    return (window as unknown as { __cardReady?: boolean }).__cardReady === true;
  }, undefined, { timeout: 15000 });

  // SVG bounding box 周辺をキャプチャ。
  const svgElement = page.locator('svg').first();
  await svgElement.waitFor({ state: 'visible' });
  const buf = await svgElement.screenshot({ type: 'png', omitBackground: true });

  await writeFile(OUT, buf);
  console.log(`[capture] saved → ${OUT}  (${buf.byteLength} bytes)`);

  await browser.close();

  // pngquant があれば自動圧縮 (8bit パレット PNG)。GitHub README は毎 view で
  // PNG を配るので帯域削減になる。pngquant 未インストールなら警告のみで継続。
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
