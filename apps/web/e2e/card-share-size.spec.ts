import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * カード共有用 Blob のサイズ実測。
 * 実際のカード SVG 構造に近い stub を用意して、cardToShareBlob が
 * 100KB 以下に収まるか・WebP として返るかを検証する。
 */
test('cardToShareBlob 相当の処理で 100KB 以下に圧縮できる', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // ── card-export.ts の cardToShareBlob と同等の処理をインライン実装 ──
    // (bundled module を直接 import できないため複製)
    const SHARE_W = 1024;
    const SHARE_H = 1430;
    const MAX_BYTES = 100 * 1024;

    // テスト用 SVG: グラデーション + アート枠 + 多数のテキストでカードを模擬
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('viewBox', '0 0 768 1072');
    svg.setAttribute('width', '768');
    svg.setAttribute('height', '1072');
    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1a3050" />
        <stop offset="0.5" stop-color="#3a6a9a" />
        <stop offset="1" stop-color="#7a9ec0" />
      </linearGradient>
      <radialGradient id="art" cx="0.5" cy="0.4" r="0.6">
        <stop offset="0" stop-color="#ffd070" />
        <stop offset="0.7" stop-color="#a04030" />
        <stop offset="1" stop-color="#201020" />
      </radialGradient>`;
    svg.appendChild(defs);
    const bg = document.createElementNS(svgNS, 'rect');
    bg.setAttribute('width', '768'); bg.setAttribute('height', '1072'); bg.setAttribute('fill', 'url(#bg)');
    svg.appendChild(bg);
    const art = document.createElementNS(svgNS, 'rect');
    art.setAttribute('x', '40'); art.setAttribute('y', '120'); art.setAttribute('width', '688'); art.setAttribute('height', '600');
    art.setAttribute('fill', 'url(#art)');
    svg.appendChild(art);
    for (let i = 0; i < 8; i++) {
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', '60'); t.setAttribute('y', String(780 + i * 28));
      t.setAttribute('font-family', 'serif'); t.setAttribute('font-size', '22'); t.setAttribute('fill', '#fff');
      t.textContent = '青空のかけらが、指の隙間を縫っていく。';
      svg.appendChild(t);
    }

    // SVG → canvas
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('img load failed'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_W; canvas.height = SHARE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, SHARE_W, SHARE_H);
    URL.revokeObjectURL(url);

    // WebP encoder 利用可否
    function canWebp(): boolean {
      try {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        return c.toDataURL('image/webp').startsWith('data:image/webp');
      } catch { return false; }
    }
    const mime = canWebp() ? 'image/webp' : 'image/jpeg';

    async function toBlob(q: number): Promise<Blob> {
      return new Promise((res, rej) => {
        canvas.toBlob((b) => b ? res(b) : rej(new Error('null')), mime, q);
      });
    }

    const tries: Array<{ q: number; size: number }> = [];
    let chosen: Blob | null = null;
    for (const q of [0.85, 0.78, 0.7, 0.62, 0.55, 0.5]) {
      const b = await toBlob(q);
      tries.push({ q, size: b.size });
      if (!chosen) chosen = b;
      if (b.size <= MAX_BYTES) { chosen = b; break; }
      chosen = b;
    }
    // 確認用にバイト列も返す
    const buf = new Uint8Array(await chosen!.arrayBuffer());
    return { size: chosen!.size, type: chosen!.type, mime, tries, bytes: Array.from(buf) };
  });
  console.log('=== card share blob measurement ===');
  console.log('mime:', result.mime);
  console.log('tries:', result.tries);
  console.log('chosen:', result.size, 'bytes');
  // 確認用にファイル出力 (PNG / JPEG / WebP のいずれか)
  const ext = result.mime === 'image/webp' ? 'webp' : 'jpg';
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `card-share-sample.${ext}`);
  writeFileSync(path, Buffer.from(result.bytes));
  console.log('saved sample image to:', path);
  expect(result.size).toBeLessThanOrEqual(100 * 1024);
});
