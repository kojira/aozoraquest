import { test, expect } from '@playwright/test';

/**
 * **とくぎが増えても「にげる」「どうぐ」が押せる**ことを実測で固定する (#547 レビュー ★★★)。
 *
 * とくぎを最初から個別に並べる UI にしたとき、下段グリッドに `gridTemplateRows` が無く
 * 暗黙行が max-content で伸びたため、とくぎ 5 個 (職 Lv10) からコマンド窓が固定高
 * (BOTTOM_H) を突き抜け、戦闘オーバーレイの `overflow:hidden` に切られて**描画も
 * 当たり判定も消えていた**。HP が減っても逃げも回復もできない詰みになる。
 *
 * ゲームを実際に職 Lv25 まで進めるのは e2e では現実的でないので、**同じ CSS 構造を
 * その場で組んで測る**。`world-battle-controls.tsx` のスタイルを変えたらここも
 * 直す必要がある (= 構造が変わったことに気づける)。
 */

/** world-battle-controls.tsx と同じ構造。変えたらこちらも揃える。 */
const BOTTOM_H = '7.8em';

function page(skillCount: number): string {
  const rows = Array.from({ length: skillCount }, (_, i) => `<button class="dq-command" style="width:100%;flex-shrink:0">とくぎ${i + 1}</button>`).join('');
  return `
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-size: 16px; font-family: sans-serif; }
  /* styles.css の .dq-command (タップ下限) */
  .dq-command { min-height: 2.4em; display: block; border: 0; background: #223; color: #fff; font-size: 0.95em; line-height: 1.2; }
  #overlay { height: 420px; display: flex; flex-direction: column; overflow: hidden; }
  #field { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  #bottom { flex: 0 0 ${BOTTOM_H}; height: ${BOTTOM_H}; }
  .win { border: 2px solid #fff; border-radius: 4px; background: #101a1a; }
</style>
<div id="overlay">
  <div id="field"></div>
  <div id="bottom">
    <div id="grid" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr);gap:0.4em;height:100%">
      <div class="win" style="height:100%;padding:0.2em 0.3em;display:grid;grid-template-rows:repeat(4,1fr);row-gap:0.1em">
        <button class="dq-command" id="cmd-attack" style="width:100%;min-height:0">たたかう</button>
        <button class="dq-command" id="cmd-guard" style="width:100%;min-height:0">ぼうぎょ</button>
        <button class="dq-command" id="cmd-item" style="width:100%;min-height:0">どうぐ</button>
        <button class="dq-command" id="cmd-flee" style="width:100%;min-height:0">にげる</button>
      </div>
      <div class="win" id="skills" style="height:100%;min-height:0;overflow-y:auto;padding:0.2em 0.4em;display:flex;flex-direction:column;row-gap:0.1em">${rows}</div>
    </div>
  </div>
</div>`;
}

// 実装上の最大は 魔法使い Lv25 の 9 個 (JOB_KITS)。念のため 12 まで見る。
for (const width of [320, 390]) {
  for (const n of [1, 4, 5, 6, 9, 12]) {
    test(`幅${width}px・とくぎ${n}個: 左コマンドが 4 つとも枠内に収まる`, async ({ page: p }) => {
      await p.setViewportSize({ width, height: 700 });
      await p.setContent(page(n));

      const bottom = await p.locator('#bottom').boundingBox();
      expect(bottom).not.toBeNull();
      const limit = bottom!.y + bottom!.height;

      for (const id of ['cmd-attack', 'cmd-guard', 'cmd-item', 'cmd-flee']) {
        const box = await p.locator(`#${id}`).boundingBox();
        expect(box, `${id} が描画されていない`).not.toBeNull();
        // 下端が下段の枠を 1px でも超えたら overflow:hidden に切られる
        expect(box!.y + box!.height, `${id} が下段の枠 (${limit.toFixed(1)}px) をはみ出す`).toBeLessThanOrEqual(limit + 0.5);
        // タップできる高さがあること (.dq-command の min-height 2.4em を潰していない)
        expect(box!.height, `${id} のタップ高さ`).toBeGreaterThan(20);
      }
    });

    test(`幅${width}px・とくぎ${n}個: とくぎ行が潰れず、あふれたらスクロールできる`, async ({ page: p }) => {
      await p.setViewportSize({ width, height: 700 });
      await p.setContent(page(n));

      const rows = p.locator('#skills .dq-command');
      await expect(rows).toHaveCount(n);
      // 全行がタップ下限 (2.4em = 約 36px) を保っている = 詰め込みで潰れていない
      for (let i = 0; i < n; i++) {
        const box = await rows.nth(i).boundingBox();
        expect(box!.height, `とくぎ${i + 1} の高さ`).toBeGreaterThanOrEqual(30);
      }
      // 入りきらない件数では実際にスクロールできること (切り捨てられていない)
      const { scrollH, clientH } = await p.locator('#skills').evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
      if (scrollH > clientH) {
        await p.locator('#skills').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const top = await p.locator('#skills').evaluate((el) => el.scrollTop);
        expect(top, 'あふれているのにスクロールできない').toBeGreaterThan(0);
      }
    });
  }
}
