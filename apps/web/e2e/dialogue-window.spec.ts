import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';

let vite: ViteDevServer;
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react()],
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: 4179, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
test.use({ hasTouch: true });
const shots = process.env.DIALOGUE_SHOTS;
// The speaker plate is sized by its text; when the Noto Sans JP web font subsets finish loading
// (Linux CI, no Hiragino) its width shifts by ~0.1px (#735). Compare each value within 1px.
const expectPlateAt = (box: { x: number; y: number; width: number; height: number } | null, plate: NonNullable<typeof box>) => {
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(box![k] - plate[k]), k).toBeLessThan(1);
};

for (const width of [320, 390, 1280]) {
  test(`DialogueWindow map fixed geometry, typing and scrolling at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:4179/e2e/fixtures/dialogue-window.html');
    const body = page.locator('.aq-dialogue-pane').last();
    const backdrop = page.locator('.aq-dialogue-backdrop');
    const image = page.getByRole('img');
    await expect(image).toHaveJSProperty('naturalWidth', 512);
    const map = (await page.getByTestId('map-inner').boundingBox())!;
    const frame = (await body.boundingBox())!;
    const portrait = (await image.boundingBox())!;
    const plate = (await page.locator('.aq-dialogue-pane').first().boundingBox())!;
    expect(Math.abs(frame.width - map.width * .96)).toBeLessThan(1);
    expect(Math.abs(frame.height - map.height * .35)).toBeLessThan(1);
    // The portrait's cut lower edge is hidden behind the text window.
    expect(portrait.y + portrait.height).toBeGreaterThan(frame.y);
    await expect(page.locator('.aq-dialogue-next')).toHaveCount(0); // Still typing.
    const next = () => backdrop.click({ position: { x: 2, y: 2 } });
    await next(); // Complete short speech, without moving the frame/portrait.
    expect(await body.boundingBox()).toEqual(frame);
    expect(await image.boundingBox()).toEqual(portrait);
    await next(); await next(); // Long speech, fully visible in its scroll area.
    expect(await body.boundingBox()).toEqual(frame);
    expect(await image.boundingBox()).toEqual(portrait);
    expectPlateAt(await page.locator('.aq-dialogue-pane').first().boundingBox(), plate);
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.focus();
    await page.keyboard.press('End');
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await body.evaluate(el => { el.scrollTop = 0; });
    // Real touch scrolling in Chromium, not synthetic DOM scroll events.
    const cdp = await page.context().newCDPSession(page);
    const x = frame.x + frame.width / 2;
    const y = frame.y + frame.height - 15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let dy = 10; dy <= 70; dy += 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(body).toContainText('【説明のおわり】');
    // Mouse drag followed by click must also not advance (native mouse drag emits click).
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, y - 30, { steps: 5 }); await page.mouse.up();
    await expect(body).toContainText('【説明のおわり】');
    expect(await body.boundingBox()).toEqual(frame);
    if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/long-scroll-${width}.png` }); }
    await next(); await next(); // Narration, completed.
    expect(await body.boundingBox()).toEqual(frame);
    expect(await body.evaluate(el => el.scrollTop)).toBe(0);
    await expect(image).toHaveCount(0);
    await next(); await next(); // Named speech without a portrait.
    expect(await body.boundingBox()).toEqual(frame);
    await expect(image).toHaveCount(0);
    await next(); await next(); // Guild choices.
    expect(await body.boundingBox()).toEqual(frame);
    expect(await image.boundingBox()).toEqual(portrait);
    expectPlateAt(await page.locator('.aq-dialogue-pane').first().boundingBox(), plate);
    const last = page.getByRole('button', { name: 'やめる', exact: true });
    await backdrop.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab');
    await expect(last).toBeFocused();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(frame.y + frame.height);
    if (shots) await page.screenshot({ path: `${shots}/last-choice-${width}.png` });
    if (width === 320) {
      await page.mouse.move(lastBox.x + 10, lastBox.y + 10); await page.mouse.down();
      await page.mouse.move(lastBox.x + 30, lastBox.y + 10, { steps: 3 }); await page.mouse.up();
      await expect(last).toBeVisible(); // Drag ending on a choice must not select it.
      await last.tap();
    } else await page.keyboard.press('Enter');
    await expect(page.getByText('会話終了')).toBeVisible();
  });
}

test('DialogueWindow viewport remains content-sized and footer-anchored', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:4179/e2e/fixtures/dialogue-window.html?viewport');
  const body = page.locator('.aq-dialogue-pane').last();
  await expect(page.locator('.aq-dialogue-next')).toBeVisible();
  const before = (await body.boundingBox())!;
  await page.locator('.aq-dialogue-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(body).toContainText('【説明のおわり】');
  await expect.poll(async () => (await body.boundingBox())!.height).toBeGreaterThan(before.height);
  const after = (await body.boundingBox())!;
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.y + after.height).toBeCloseTo(before.y + before.height);
  expect(Math.abs(after.width - 390 * .94)).toBeLessThan(1);
});
