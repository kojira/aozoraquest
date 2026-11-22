import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * ねらう相手を選ぶ窓 (BattleTargetPicker) の 390px の実測 (#1004)。見出しは出さず、行は枠なしの文字だけ。
 * 敵 2 体 + もどる はスクロールなしで収まる。窓は 7.8em の固定高で行はタップ下限 2.4em なので、
 * 敵 3 体・味方 4 人は窓がスクロールし、下に張りついた もどる が最後の行をかくさない。
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

/** 行が枠なし・タップできる高さ。fits なら窓があふれない。あふれる件数でも、下まで送れば最後の行が もどる にかくれない。 */
async function expectPicker(page: Page, names: string[], fits: boolean, shotName: string) {
  await expect(page.getByText('だれを ねらう？')).toHaveCount(0);
  await expect(page.getByText('だれを かいふくする？')).toHaveCount(0);
  const back = page.locator('[data-picker-back]');
  const picker = back.locator('..');
  const rows = [...names.map((n) => page.getByRole('button', { name: n, exact: true })), back.getByRole('button', { name: 'もどる' })];
  for (const row of rows) {
    const look = await row.evaluate((el) => { const st = getComputedStyle(el); return { border: st.borderTopWidth, shadow: st.boxShadow, h: el.getBoundingClientRect().height }; });
    expect(look.border, '行に枠がある').toBe('0px');
    expect(look.shadow, '行に内側の線がある').toBe('none');
    expect(look.h, 'タップできる高さ').toBeGreaterThanOrEqual(36);
  }
  const { scrollH, clientH } = await picker.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  if (fits) expect(scrollH, '選ぶ窓があふれてスクロールが要る').toBeLessThanOrEqual(clientH);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, shotName) });
  }
  if (!fits) await picker.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const backBox = (await back.boundingBox())!;
  const last = (await page.getByRole('button', { name: names.at(-1)!, exact: true }).boundingBox())!;
  expect(last.y + last.height, '最後の行が もどる にかくれる').toBeLessThanOrEqual(backBox.y + 0.5);
  if (fits) {
    for (const n of names) {
      const box = (await page.getByRole('button', { name: n, exact: true }).boundingBox())!;
      expect(box.y + box.height, `${n} が もどる にかくれる`).toBeLessThanOrEqual(backBox.y + 0.5);
    }
  }
}

for (const n of [2, 3]) {
  test(`敵 ${n} 体: たたかう → 枠なしの行で選べる。2 体は スクロールなしで収まる (390px)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:4183/e2e/fixtures/battle-target-picker.html?enemies=${n}`);
    await page.getByRole('button', { name: 'たたかう' }).click();
    await expectPicker(page, ['そらいろスライム', 'すなウサギ', 'もりのコウモリ'].slice(0, n), n === 2, `picker-enemies-${n}.png`);
  });
}

test('味方 4 人: 聖光の癒し → 枠なしの行で選べ、送れば最後の人も もどる にかくれない (390px)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4183/e2e/fixtures/battle-target-picker.html?enemies=1&allies=4');
  await page.getByRole('button', { name: '聖光の癒し' }).click();
  await expectPicker(page, ['ゆうしゃ', 'カイト', 'ソラ', 'ミオ'], false, 'picker-allies-4.png');
});
