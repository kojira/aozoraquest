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

  // SVG が render されて window.__cardSvg がセットされるまで待つ。
  await page.waitForFunction(() => {
    const svg = (window as unknown as { __cardSvg?: SVGSVGElement }).__cardSvg;
    return !!svg;
  }, undefined, { timeout: 10000 });

  // 少し待ってアバター画像が data URL に inline されるのを待つ。
  await page.waitForTimeout(1500);

  // SVG bounding box 周辺をキャプチャ。
  const svgElement = page.locator('svg').first();
  await svgElement.waitFor({ state: 'visible' });
  const buf = await svgElement.screenshot({ type: 'png', omitBackground: true });

  await writeFile(OUT, buf);
  console.log(`[capture] saved → ${OUT}  (${buf.byteLength} bytes)`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
