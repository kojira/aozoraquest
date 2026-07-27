import { test, expect } from '@playwright/test';

/**
 * **ドット絵が拡大縮小で崩れない**ことを実測で固定する (#421)。
 *
 * SVG の矩形は既定でアンチエイリアスされる。16×16 のドット絵を 24px や 16px で出すと
 * 1 画素が 1 デバイス画素に一致しないため、境界が補間されて:
 *  - 隣り合う画素の間に**中間色のスジ**が入る (実機の 24px 表示で発生)
 *  - 縮小時は**潰れて別の色**になる (同 16px 表示)
 *
 * `shape-rendering: crispEdges` で最近傍に倒すと、どの倍率でも画素のまま出る。
 * ここでは**実際に描画して画素を採取**し、中間色が出ていないことを見る。
 */

/** 16×16 の市松模様。2 色だけで描く = 中間色が出たら補間されている。 */
const A = '#ff0000';
const B = '#0000ff';

function page(tilePx: number, crisp: boolean): string {
  const rects: string[] = [];
  const px = 32 / 16; // 16×16 を 32 単位の viewBox に
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      rects.push(
        `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${(x + y) % 2 === 0 ? A : B}"/>`,
      );
    }
  }
  return `
<style>* { margin: 0; } body { background: #000; }</style>
<svg id="t" width="${tilePx}" height="${tilePx}" viewBox="0 0 32 32" style="display:block">
  <g ${crisp ? 'shape-rendering="crispEdges"' : ''}>${rects.join('')}</g>
</svg>`;
}

/** 描画結果から、赤でも青でもない「中間色」の画素の割合を出す。 */
async function blendRatio(p: import('@playwright/test').Page, tilePx: number, crisp: boolean): Promise<number> {
  await p.setViewportSize({ width: 400, height: 400 });
  await p.setContent(page(tilePx, crisp));
  const shot = await p.locator('#t').screenshot();
  return p.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width;
    cv.height = bmp.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let blended = 0;
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      total++;
      const isA = r > 200 && g < 60 && b < 60;
      const isB = b > 200 && g < 60 && r < 60;
      if (!isA && !isB) blended++;
    }
    return blended / total;
  }, Array.from(shot));
}

for (const tilePx of [16, 24, 32, 48]) {
  test(`${tilePx}px 表示でドット絵に中間色が出ない`, async ({ page: p }) => {
    const crisp = await blendRatio(p, tilePx, true);
    // 完全な最近傍なら 0。端の丸めで僅かに出ることはあるので少しだけ許す。
    expect(crisp, `${tilePx}px の中間色の割合 ${(crisp * 100).toFixed(1)}%`).toBeLessThan(0.05);
  });
}

test('アンチエイリアスを切らないと実際に中間色が出る (この対策が効いていることの裏取り)', async ({ page: p }) => {
  // 24px は 16 画素を 0.75 倍で出すので境界がデバイス画素に乗らない = 一番出やすい。
  const off = await blendRatio(p, 24, false);
  const on = await blendRatio(p, 24, true);
  expect(off, `切らない場合の中間色 ${(off * 100).toFixed(1)}%`).toBeGreaterThan(0.05);
  expect(on).toBeLessThan(off);
});
