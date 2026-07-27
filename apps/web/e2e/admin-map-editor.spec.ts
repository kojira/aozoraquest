import { test, expect } from '@playwright/test';

/**
 * **マップエディタがパーツを置ける形になっている**ことを実測で固定する (#421)。
 *
 * 最初は 1 タイル 1 画素で色を塗る形にしていたが、**1 ドットに対する操作は現実的でない**
 * (何を塗ったか見えない / どの色がどの地形か分からない)。ワールド画面と同じタイルの絵を
 * 並べて置く形に変えた。ここで固定するのは:
 *  - タイルが**絵として見える大きさ**で並ぶ (画素 1 個ではない)
 *  - **グリッド線**が出る / 消せる
 *  - 当たり判定がタイル単位で敷かれている (絵の中の要素やグリッド線で拾い漏らさない)
 *
 * 実データでの描画は認証が要るので、ここでは同じ SVG 構造を組んで幾何だけを見る。
 * `admin-map.tsx` の COLS / ROWS / viewBox を変えたらここも直す (= 構造が変わったと気づける)。
 */

/** 表示は**正方形**。倍率を変えるとタイル数が変わり、枠の px は一定に保たれる
 *  (24×16 固定だと 16px 表示で横長に潰れていた)。admin-map.tsx の BOX と揃える。 */
const BOX = 384;
const view = (tilePx: number) => Math.max(8, Math.round(BOX / tilePx));

function page(tilePx: number, grid: boolean): string {
  const COLS = view(tilePx);
  const ROWS = COLS;
  const cells: string[] = [];
  const hits: string[] = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      cells.push(`<g transform="translate(${cx * 32},${cy * 32})"><rect width="32" height="32" fill="#9dd07f"/></g>`);
      hits.push(`<rect class="hit" data-cx="${cx}" data-cy="${cy}" x="${cx * 32}" y="${cy * 32}" width="32" height="32" fill="transparent"/>`);
    }
  }
  const lines: string[] = [];
  if (grid) {
    for (let i = 0; i <= COLS; i++) lines.push(`<line class="grid" x1="${i * 32}" y1="0" x2="${i * 32}" y2="${ROWS * 32}" stroke="#000" stroke-opacity="0.22"/>`);
    for (let i = 0; i <= ROWS; i++) lines.push(`<line class="grid" x1="0" y1="${i * 32}" x2="${COLS * 32}" y2="${i * 32}" stroke="#000" stroke-opacity="0.22"/>`);
  }
  return `
<style>* { margin: 0; box-sizing: border-box; }</style>
<div id="wrap" style="overflow:auto;width:fit-content;border:2px solid #555">
  <svg id="map" width="${COLS * tilePx}" height="${ROWS * tilePx}" viewBox="0 0 ${COLS * 32} ${ROWS * 32}" style="display:block">
    ${cells.join('')}
    <g style="pointer-events:none">${lines.join('')}</g>
    ${hits.join('')}
  </svg>
</div>`;
}

for (const tilePx of [16, 24, 32, 48]) {
  test(`タイル ${tilePx}px: 絵として見える大きさで並ぶ`, async ({ page: p }) => {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.setContent(page(tilePx, true));
    const box = await p.locator('.hit').first().boundingBox();
    expect(box).not.toBeNull();
    // 1 タイルが指定どおりの大きさで描かれている (1 画素ではない)
    expect(Math.round(box!.width), 'タイル幅').toBe(tilePx);
    expect(Math.round(box!.height), 'タイル高さ').toBe(tilePx);
    // 最小でも 16px = パーツの形が分かる下限
    expect(box!.width).toBeGreaterThanOrEqual(16);
  });

  test(`タイル ${tilePx}px: 隣と重ならず隙間もない`, async ({ page: p }) => {
    await p.setViewportSize({ width: 1280, height: 900 });
    await p.setContent(page(tilePx, true));
    const a = await p.locator('.hit[data-cx="0"][data-cy="0"]').boundingBox();
    const b = await p.locator('.hit[data-cx="1"][data-cy="0"]').boundingBox();
    const c = await p.locator('.hit[data-cx="0"][data-cy="1"]').boundingBox();
    expect(Math.round(b!.x - a!.x), '横の間隔').toBe(tilePx);
    expect(Math.round(c!.y - a!.y), '縦の間隔').toBe(tilePx);
  });
}

test('グリッド線が出る / 消せる', async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.setContent(page(24, true));
  const n = view(24);
  await expect(p.locator('.grid')).toHaveCount(n + 1 + n + 1);
  await p.setContent(page(24, false));
  await expect(p.locator('.grid')).toHaveCount(0);
});

test('当たり判定が全タイルに敷かれ、グリッド線に邪魔されない', async ({ page: p }) => {
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.setContent(page(24, true));
  await expect(p.locator('.hit')).toHaveCount(view(24) * view(24));
  const box = await p.locator('.hit[data-cx="5"][data-cy="5"]').boundingBox();
  const at = (x: number, y: number) => p.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py) as SVGElement | null;
    return el?.getAttribute('class') ?? el?.tagName ?? null;
  }, [x, y] as const);
  // 中心
  expect(await at(box!.x + box!.width / 2, box!.y + box!.height / 2), 'タイルの中心').toBe('hit');
  // **グリッド線そのものの真上**を突く。グリッドが pointer-events を拾うと、線をなぞった
  // ときだけ置けない (= ドラッグで塗ると筋状に抜ける) という分かりにくい壊れ方をする。
  // 線は 1px 未満に縮むので、線自身の bbox の中心を使う (座標を手で足すと外れる)。
  const line = await p.locator('.grid').nth(6).boundingBox();
  expect(line, 'グリッド線が見つからない').not.toBeNull();
  expect(
    await at(line!.x + line!.width / 2, line!.y + line!.height / 2),
    'グリッド線の真上をクリックしたときに当たる要素',
  ).toBe('hit');
});

test('どの倍率でも表示が正方形になる', async ({ page: p }) => {
  // 24×16 タイル固定にしていたため、16px 表示で 384×256 の横長に潰れていた。
  await p.setViewportSize({ width: 1280, height: 900 });
  for (const tilePx of [16, 24, 32, 48]) {
    await p.setContent(page(tilePx, true));
    const box = await p.locator('#map').boundingBox();
    expect(Math.round(box!.width), `${tilePx}px の幅`).toBe(Math.round(box!.height));
  }
});
