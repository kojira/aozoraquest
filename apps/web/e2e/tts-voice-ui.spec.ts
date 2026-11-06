import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { zenTtsAssetsPlugin } from '../vite-zen-tts-assets';

/**
 * D-TTS-001: 390px で、会話窓の「🔊 声」→ 初回ダウンロードの進捗 → ON で実際に声が鳴る、設定のトグルとクレジット。
 * 約41MB を取るので手元で AQ_TTS_E2E=1 の時だけ (CI では skip)。AQ_TTS_SHOT_DIR があればスクショを書く。
 */
const PORT = 4292;
const BASE = `http://127.0.0.1:${PORT}/e2e/fixtures/tts-voice-ui.html`;
let vite: ViteDevServer;
test.skip(!process.env.AQ_TTS_E2E, 'downloads ~41MB; run locally with AQ_TTS_E2E=1');
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), zenTtsAssetsPlugin()],
    optimizeDeps: { exclude: ['zen-tts'] }, resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });
const shot = (name: string) => (process.env.AQ_TTS_SHOT_DIR ? { path: path.join(process.env.AQ_TTS_SHOT_DIR, name) } : {});

test('会話窓の「🔊 声」で初回ダウンロードし、Blueskyちゃんの行が声で鳴る', async ({ page }) => {
  // AudioBufferSourceNode.start を数える (headless でも実際に再生まで来たかを見る)
  await page.addInitScript(() => {
    const w = window as unknown as { aqStarts: number[] };
    w.aqStarts = [];
    const orig = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof orig>) { w.aqStarts.push(this.buffer?.length ?? 0); return orig.apply(this, a); };
  });
  await page.goto(BASE);
  const toggle = page.getByRole('button', { name: '🔊 声' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot(shot('1-dialogue-toggle-off.png'));
  await toggle.click();
  await expect(page.getByRole('status')).toBeVisible();
  // 途中の値 (0 でも完了でもない) で撮る
  await expect(page.getByRole('status')).toContainText(/\b([1-9]|[1-3]\d|40)\/41MB/);
  await page.screenshot(shot('2-dialogue-downloading.png'));
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 });
  await expect(page.getByText('いらっしゃい！', { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { aqStarts: number[] }).aqStarts.filter((n) => n > 44100).length), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.screenshot(shot('3-dialogue-toggle-on.png'));
  // 送ると次の行も鳴る (先に合成した分)
  const map = page.getByTestId('map-inner');
  await page.getByRole('dialog').first().click({ position: { x: 5, y: 5 } });
  await page.getByRole('dialog').first().click({ position: { x: 5, y: 5 } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { aqStarts: number[] }).aqStarts.filter((n) => n > 44100).length), { timeout: 60_000 }).toBeGreaterThan(1);
  await expect(map).toContainText('冒険者ギルド');
  // 設定: 同じ端末なので ON のまま、クレジットはリンク
  await page.goto(`${BASE}?view=settings`);
  await expect(page.getByRole('button', { name: '🔊 声' })).toHaveAttribute('aria-pressed', 'true');
  const links = page.getByRole('link', { name: 'https://zenryokukikai.com' });
  await expect(links).toHaveCount(2);
  await expect(page.getByText('音声合成：ZEN-TTS（https://zenryokukikai.com ）').first()).toBeVisible();
  await page.screenshot(shot('4-settings-credit.png'), { fullPage: true } as never);
});
