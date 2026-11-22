import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 戦闘の窓の 390×844 の実測 (#1004・D-PARTY-005)。fixture は world.tsx と同じ四角い地図枠と戦闘オーバーレイ。
 * - 右の窓 (相手を選ぶ・とくぎ・どうぐ) は中身に合わせて上へ伸び、スクロールしない (下の窓に かぶってよい)。
 *   敵 5 体 + もどる・味方 4 人 + もどる・魔法使い Lv25 のとくぎ 9 個 が全部見えて押せる。
 * - 行は枠なしの文字だけ。左のコマンドも同じ。行はタップできる高さ。
 * - 敵 5 体の段は、絵・名前・HP がたがいに重ならない。
 */
let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4183, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shots = process.env.PICKER_SHOTS;
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, name) });
};
const open = (page: Page, q: string) => page.goto(`http://127.0.0.1:4183/e2e/fixtures/battle-target-picker.html?${q}`);

/** 行が枠なし。タップできる高さ (左のコマンドは下段 7.8em を 4 等分したセルの高さで、枠があったときと同じ約 27px)。 */
async function expectFrameless(page: Page, names: string[], minH = 30) {
  for (const n of names) {
    const look = await page.getByRole('button', { name: n, exact: true }).evaluate((el) => { const st = getComputedStyle(el); return { border: st.borderTopWidth, shadow: st.boxShadow, h: el.getBoundingClientRect().height }; });
    expect(look.border, `${n} に枠がある`).toBe('0px');
    expect(look.shadow, `${n} に内側の線がある`).toBe('none');
    expect(look.h, `${n} のタップの高さ`).toBeGreaterThanOrEqual(minH);
  }
}

/** 右の窓がスクロールせず、行が全部 窓の中・画面の中に見える。 */
async function expectWindowFits(page: Page, names: string[]) {
  const win = page.locator('[data-battle-window]');
  const { scrollH, clientH } = await win.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  expect(scrollH, '窓がスクロールしている').toBeLessThanOrEqual(clientH + 1);
  const box = (await win.boundingBox())!;
  const overlay = (await page.locator('[data-battle-overlay]').boundingBox())!;
  expect(box.y, '窓が戦闘の枠の上へはみ出す').toBeGreaterThanOrEqual(overlay.y);
  for (const n of names) {
    const row = page.getByRole('button', { name: n, exact: true });
    await expect(row).toBeInViewport({ ratio: 1 });
    const r = (await row.boundingBox())!;
    expect(r.y, `${n} が窓の上に切れる`).toBeGreaterThanOrEqual(box.y);
    expect(r.y + r.height, `${n} が窓の下に切れる`).toBeLessThanOrEqual(box.y + box.height + 0.5);
  }
}

const FIVE = ['そらいろスライム', 'すなウサギ', 'もりのコウモリ', 'こけむしゴーレム', 'よぞらカラス'];

for (const n of [2, 3, 5]) {
  test(`敵 ${n} 体: たたかう → 枠なしの行で選べ、もどる まで スクロールなしで見える (390×844)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `enemies=${n}`);
    await page.getByRole('button', { name: 'たたかう' }).click();
    await expect(page.getByText('だれを ねらう？')).toHaveCount(0);
    const names = [...FIVE.slice(0, n), 'もどる'];
    await expectFrameless(page, names);
    await expectWindowFits(page, names);
    await shot(page, `picker-enemies-${n}.png`);
  });
}

test('味方 4 人: 聖光の癒し → 4 人 + もどる が スクロールなしで見える (390×844)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'enemies=1&allies=4');
  await page.getByRole('button', { name: '聖光の癒し' }).click();
  await expect(page.getByText('だれを かいふくする？')).toHaveCount(0);
  const names = ['ゆうしゃ', 'カイト', 'ソラ', 'ミオ', 'もどる'];
  await expectFrameless(page, names);
  await expectWindowFits(page, names);
  await shot(page, 'picker-allies-4.png');
});

for (const width of [320, 390]) {
  test(`幅 ${width}px・魔法使い Lv25 のとくぎ: 390px は全部 スクロールなしで見え (320px は地図が小さいので窓の中を送れる)、左のコマンドは 4 つとも押せる`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page, 'enemies=2&job=mage&lv=25');
    const win = page.locator('[data-battle-window]');
    const skills = await win.getByRole('button').allTextContents();
    expect(skills.length, 'とくぎが少ない (fixture が長い一覧になっていない)').toBeGreaterThanOrEqual(8);
    if (width === 390) await expectWindowFits(page, skills);
    else {
      await win.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(win.getByRole('button', { name: skills.at(-1)!, exact: true })).toBeInViewport({ ratio: 1 });
    }
    // 2.4em では入らないので行を少しつめる (左のコマンドと同じ約 27px)
    for (const n of skills) expect((await win.getByRole('button', { name: n, exact: true }).boundingBox())!.height, `${n} の高さ`).toBeGreaterThanOrEqual(26);
    for (const n of ['たたかう', 'ぼうぎょ', 'どうぐ', 'にげる']) {
      const b = page.locator('[data-battle-commands]').getByRole('button', { name: n, exact: true });
      await expect(b).toBeInViewport({ ratio: 1 });
      // 右の窓が左のコマンドにかぶらない
      const r = (await b.boundingBox())!, w = (await win.boundingBox())!;
      expect(r.x + r.width, `${n} が右の窓の下になる`).toBeLessThanOrEqual(w.x + 0.5);
    }
    if (width === 390) await shot(page, 'skills-long.png');
  });
}

test('左のコマンド: 枠なしの文字だけ。押せないもの (相手を選んでいる間の ぼうぎょ) は薄く、開いたコマンドは ▸ が出たまま。フォーカスの線が見える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'enemies=5');
  const cmds = page.locator('[data-battle-commands]');
  await expectFrameless(page, ['たたかう', 'ぼうぎょ', 'どうぐ', 'にげる'], 26);
  const opacity = (n: string) => cmds.getByRole('button', { name: n, exact: true }).evaluate((el) => Number(getComputedStyle(el).opacity));
  await page.keyboard.press('Tab');
  const outline = await cmds.getByRole('button', { name: 'たたかう' }).evaluate((el) => (el === document.activeElement ? getComputedStyle(el).outlineStyle : 'not-focused'));
  expect(outline, 'キーボードのフォーカスの線').toBe('solid');
  const marker = (n: string) => cmds.getByRole('button', { name: n, exact: true }).evaluate((el) => getComputedStyle(el, '::before').visibility);
  await page.mouse.move(0, 0);
  await page.getByRole('button', { name: 'たたかう' }).click();
  await page.mouse.move(0, 0);
  expect(await marker('たたかう'), '相手を選んでいる間 ▸ が出たまま').toBe('visible');
  expect(await marker('にげる')).toBe('hidden');
  await expect(cmds.getByRole('button', { name: 'ぼうぎょ' })).toBeDisabled();
  expect(await opacity('ぼうぎょ'), '押せない ぼうぎょ が薄くない').toBeLessThan(0.6);
  expect(await opacity('にげる')).toBe(1);
  await shot(page, 'commands-frameless.png');
});

test('敵 5 体 (見抜ける職): 絵・名前・HP がたがいに重ならず、390px に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'enemies=5&vitals=1');
  const enemies = page.locator('[data-enemy]');
  await expect(enemies).toHaveCount(5);
  const boxes = await enemies.evaluateAll((els) => els.map((el) => {
    const parts = [...el.querySelectorAll('svg, [data-enemy-name], [data-enemy-hp]')].map((p) => p.getBoundingClientRect());
    return { left: Math.min(...parts.map((r) => r.left)), right: Math.max(...parts.map((r) => r.right)), names: el.querySelectorAll('[data-enemy-name]').length, hp: el.querySelectorAll('[data-enemy-hp]').length };
  }));
  for (const b of boxes) { expect(b.names).toBe(1); expect(b.hp).toBe(1); expect(b.left).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(390); }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left, `${i} 体目と ${i + 1} 体目が重なる`).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 0.5);
  // 名前は省略しない (折り返して全部見える)
  for (const n of FIVE) await expect(page.locator('[data-enemy-name]', { hasText: n })).toBeVisible();
  await shot(page, 'enemies-5.png');
});
