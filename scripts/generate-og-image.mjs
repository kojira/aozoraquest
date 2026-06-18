/**
 * 共有用 OG 画像 (1200×630) を生成して apps/web/public/og.png に保存する。
 *
 *   pnpm tsx scripts/generate-og-image.mjs   (または node)
 *
 * 世界観に合わせ、本体 (styles.css) と同じ青空→草地グラデーション + 精霊の雲マスコット
 * (spirit-icon.tsx の SVG を流用) + タイトルで構成する。フォントはアプリと同じ
 * Hiragino Maru Gothic / Noto Sans JP 系。playwright で 1200×630 を screenshot する。
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'apps/web/public/og.png');

// 精霊マスコット (spirit-icon.tsx の SVG を 0..100 viewBox のまま流用)
const spirit = `
<svg viewBox="0 0 100 100" width="260" height="260" style="display:block">
  <circle cx="50" cy="54" r="44" fill="rgba(159,215,255,0.18)"/>
  <g>
    <circle cx="32" cy="58" r="18" fill="#f6fbff"/>
    <circle cx="50" cy="48" r="24" fill="#f6fbff"/>
    <circle cx="68" cy="58" r="18" fill="#f6fbff"/>
    <ellipse cx="50" cy="66" rx="30" ry="14" fill="#f6fbff"/>
  </g>
  <ellipse cx="50" cy="72" rx="26" ry="4" fill="rgba(35,70,120,0.18)"/>
  <circle cx="35" cy="58" r="4" fill="#ffb8c5" opacity="0.5"/>
  <circle cx="65" cy="58" r="4" fill="#ffb8c5" opacity="0.5"/>
  <ellipse cx="42" cy="52" rx="2.2" ry="3" fill="#1c2b44"/>
  <ellipse cx="58" cy="52" rx="2.2" ry="3" fill="#1c2b44"/>
  <circle cx="43" cy="51" r="0.8" fill="#ffffff"/>
  <circle cx="59" cy="51" r="0.8" fill="#ffffff"/>
  <path d="M 46 60 Q 50 62.5 54 60" stroke="#1c2b44" stroke-width="1.4" fill="none" stroke-linecap="round"/>
  <g fill="#ffffff" opacity="0.85">
    <circle cx="14" cy="30" r="1.3"/><circle cx="86" cy="34" r="1.6"/>
    <circle cx="22" cy="82" r="1.1"/><circle cx="82" cy="78" r="1.1"/>
  </g>
</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  .og {
    width: 1200px; height: 630px; position: relative; overflow: hidden;
    font-family: 'Hiragino Maru Gothic ProN', 'Hiragino Maru Gothic Pro', 'Noto Sans JP', sans-serif;
    /* styles.css の body と同じ青空→草地グラデ (縦 630px に圧縮) */
    background:
      radial-gradient(220px 60px at 16% 16%, rgba(255,255,255,0.55), rgba(255,255,255,0) 70%),
      radial-gradient(320px 80px at 74% 26%, rgba(255,255,255,0.5), rgba(255,255,255,0) 70%),
      radial-gradient(200px 50px at 46% 40%, rgba(255,255,255,0.4), rgba(255,255,255,0) 70%),
      linear-gradient(to bottom,
        #4aa6e2 0%, #7cc7ea 35%, #bee3f1 60%,
        #9dd07f 61%, #6fb052 80%, #3f7a32 100%);
  }
  .inner { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 80px; gap: 36px; }
  .text { color: #fff; flex: 1 1 auto; min-width: 0; }
  /* 8 文字 × 82px ≈ 650px で 1200px 幅には十分収まる (幅はボトルネックではない)。
     nowrap は念のための保険。 */
  .title {
    font-size: 82px; font-weight: 700; letter-spacing: 0.01em;
    white-space: nowrap; line-height: 1.1;
    text-shadow: 3px 3px 0 rgba(10,20,60,0.4), 0 2px 10px rgba(10,20,60,0.3);
  }
  /* タグラインは草地グラデ上で白文字が沈むので、濃い縁取り (text-stroke) +
     多方向シャドウでくっきりさせる。 */
  .tagline {
    margin-top: 26px; font-size: 29px; font-weight: 600; line-height: 1.6; max-width: 720px;
    -webkit-text-stroke: 3px rgba(8,20,52,0.7);
    paint-order: stroke fill;
    text-shadow:
      0 2px 4px rgba(8,20,52,0.55),
      2px 2px 0 rgba(8,20,52,0.55);
  }
  .url { margin-top: 30px; font-size: 26px; font-weight: 700; color: #06223a; background: rgba(255,255,255,0.88); display: inline-block; padding: 6px 18px; border-radius: 6px; box-shadow: 0 3px 0 rgba(0,0,0,0.18); }
  .mascot { filter: drop-shadow(0 10px 14px rgba(20,40,80,0.25)); flex: 0 0 auto; }
</style></head>
<body>
  <div class="og"><div class="inner">
    <div class="text">
      <div class="title">あおぞらくえすと</div>
      <div class="tagline">Bluesky の投稿から、今のあなたを<br>ジョブとステータスで可視化。<br>毎日のクエストで、目指す姿へ。</div>
      <div class="url">aozoraquest.app</div>
    </div>
    <div class="mascot">${spirit}</div>
  </div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('.og').screenshot({ path: out });
await browser.close();
console.log('wrote', out);
