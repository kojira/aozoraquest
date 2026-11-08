import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { zenTtsAssetsPlugin } from '../vite-zen-tts-assets';

/**
 * D-TTS-001: 本物の wrapper (tts-client → tts.worker → ZEN-TTS) が、HF の声 (commit 固定・sha256 照合) と
 * 自分のオリジンの G2P を tts-v1 に入れ、Blueskyちゃんの実際の台詞を合成できる。約41MB を取るので
 * 手元で AQ_TTS_E2E=1 の時だけ走らせる (CI では skip)。AQ_TTS_WAV_DIR があれば WAV を書き出す。
 */
const PORT = 4291;
let vite: ViteDevServer;
test.skip(!process.env.AQ_TTS_E2E, 'downloads ~41MB; run locally with AQ_TTS_E2E=1');
test.beforeAll(async () => {
  vite = await createServer({ configFile: false, root: process.cwd(), plugins: [react(), zenTtsAssetsPlugin()], optimizeDeps: { exclude: ['zen-tts'] },
    resolve: { alias: { '@': path.join(process.cwd(), 'src') } },
    server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await vite.listen();
});
test.afterAll(async () => { await vite?.close(); });

function wav(pcm: number[], rate: number): Buffer {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((x, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x)) * 0x7fff), 44 + i * 2));
  return b;
}

test('Blueskyちゃんの台詞 3 行を wrapper で合成できる (neutral / happy / apologetic)', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${PORT}/e2e/fixtures/tts-engine.html`);
  await expect(page.locator('#out')).toHaveText('ready');
  const lines = ['ここがこの町の冒険者ギルドだよ。少し休んでいってね。', 'いらっしゃい！　ふたばのわたしから聞いてるよ、手紙を持った旅人さん。', '……やっと、ちゃんと顔を見せられる。ずっと逆光で、ごめんね。'];
  const r = await page.evaluate((l) => window.ttsRun(l), lines) as { lastProgress: number; cached: string[]; cacheNames: string[]; loadMs: number; out: Array<{ text: string; emotion: Record<string, number>; sampleRate: number; ms: number; pcm: number[] }> };
  expect(r.lastProgress).toBe(1);
  expect(r.cacheNames).toEqual(['tts-v1']);
  expect(r.cached).toHaveLength(4);
  expect(r.out.map((o) => Object.keys(o.emotion)[0])).toEqual(['neutral', 'happy', 'apologetic']);
  for (const o of r.out) {
    expect(o.sampleRate).toBe(44100);
    expect(o.pcm.length / o.sampleRate).toBeGreaterThan(1);
    expect(o.pcm.reduce((m, x) => Math.max(m, Math.abs(x)), 0)).toBeGreaterThan(0.05);
  }
  console.log(JSON.stringify({ loadMs: Math.round(r.loadMs), lines: r.out.map((o) => ({ text: o.text, emotion: o.emotion, sec: +(o.pcm.length / o.sampleRate).toFixed(2), ms: Math.round(o.ms) })) }));
  const dir = process.env.AQ_TTS_WAV_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    r.out.forEach((o, i) => writeFileSync(path.join(dir, `bluesky-${i + 1}-${Object.keys(o.emotion)[0]}.wav`), wav(o.pcm, o.sampleRate)));
  }
});
