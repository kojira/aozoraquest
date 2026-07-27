import { test, expect } from '@playwright/test';

/**
 * **地図をドラッグしても文字選択が起きない**ことを固定する (#421)。
 *
 * 地図の近くに説明文があると、ドラッグで文字選択が始まってしまう。iOS では
 * その選択が解除できず、**保存ボタンも押せなくなる**ところまで行った (実機で発生)。
 *
 * `user-select: none` と `pointerdown` の `preventDefault` の両方が要る。
 * 片方だけだと、環境によって選択が残る。
 */

function page(guard: boolean): string {
  return `
<style>
  * { margin: 0; box-sizing: border-box; }
  body { font-size: 16px; }
  #root { padding: 8px; ${guard ? 'user-select: none; -webkit-user-select: none;' : ''} }
</style>
<div id="root">
  <p id="desc">パーツを選んで置く。置いただけでは何も起きない。ためす = 自分のブラウザでだけ反映する。</p>
  <svg id="map" width="320" height="200" style="display:block;touch-action:none">
    <rect width="320" height="200" fill="#9dd07f"/>
  </svg>
  <button id="save">みんなに反映</button>
</div>
<script>
  document.getElementById('map').addEventListener('pointerdown', (e) => { ${guard ? 'e.preventDefault();' : ''} });
  window.__clicked = 0;
  document.getElementById('save').addEventListener('click', () => { window.__clicked++; });
</script>`;
}

async function dragOverText(p: import('@playwright/test').Page) {
  const desc = await p.locator('#desc').boundingBox();
  const map = await p.locator('#map').boundingBox();
  // 地図の中から押し始めて、説明文の上まで指を滑らせる (実機で起きた操作)
  await p.mouse.move(map!.x + 40, map!.y + 40);
  await p.mouse.down();
  await p.mouse.move(desc!.x + 40, desc!.y + 8, { steps: 12 });
  await p.mouse.move(desc!.x + 200, desc!.y + 8, { steps: 12 });
  await p.mouse.up();
}

test('地図から文字の上へドラッグしても選択されない', async ({ page: p }) => {
  await p.setViewportSize({ width: 500, height: 500 });
  await p.setContent(page(true));
  await dragOverText(p);
  const sel = await p.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(sel, `選択された文字: ${JSON.stringify(sel)}`).toBe('');
});

test('選択が残ると保存ボタンが押せなくなる、という状況を作らない', async ({ page: p }) => {
  await p.setViewportSize({ width: 500, height: 500 });
  await p.setContent(page(true));
  await dragOverText(p);
  await p.locator('#save').click();
  expect(await p.evaluate(() => (window as unknown as { __clicked: number }).__clicked)).toBe(1);
});

test('対策なしだと実際に選択される (この対策が効いていることの裏取り)', async ({ page: p }) => {
  await p.setViewportSize({ width: 500, height: 500 });
  await p.setContent(page(false));
  await dragOverText(p);
  const sel = await p.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(sel.length, '対策なしでも選択されないならテストが無意味').toBeGreaterThan(0);
});
