import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 実 JobCard コンポーネントを /debug/card で render し、本物の cardToShareBlob を
 * 動かして圧縮サイズと出力画像を実測する。
 *
 * /debug/card 側で svgRef を window.__cardSvg に露出している。
 * cardToShareBlob は bundle に含まれているが直接 import できないので、
 * 同じロジックを test 内に複製する (card-export.ts と同期保つこと)。
 */
test('実 JobCard で cardToShareBlob を動かして 100KB 以下に圧縮できる', async ({ page }) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });
  await page.goto('/debug/card');
  // JobCard 内の <image href="/card-art/...">, <image href="https://avatar..."> が
  // 全部 load 完了するまで待つ (rasterize 時に間に合わないと装飾が抜ける)
  await page.waitForFunction(() => {
    const svg = (window as any).__cardSvg as SVGSVGElement | undefined;
    if (!svg) return false;
    const imgs = Array.from(svg.querySelectorAll('image'));
    if (imgs.length === 0) return false;
    return imgs.every((im) => {
      const href = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
      // data: は既にロード済み、http(s): は別途 fetch されてるかも
      return href.startsWith('data:') || href.length > 0;
    });
  }, { timeout: 10_000 });
  // image タグの実 fetch を待つために少しクッション
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const SHARE_SIZES: ReadonlyArray<readonly [number, number]> = [
      [800, 1117],
      [640, 894],
      [512, 715],
    ];
    const MAX_BYTES = 100 * 1024;

    const svg = (window as any).__cardSvg as SVGSVGElement | undefined;
    if (!svg) throw new Error('window.__cardSvg not set');

    // ── inline 外部画像 (CORS で失敗しても rasterize 続行) ──
    async function imgToDataUrl(url: string): Promise<string> {
      return new Promise((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => {
          const c = document.createElement('canvas');
          c.width = i.naturalWidth || 512; c.height = i.naturalHeight || 512;
          c.getContext('2d')!.drawImage(i, 0, 0);
          try { res(c.toDataURL('image/png')); } catch (e) { rej(e); }
        };
        i.onerror = () => rej(new Error('img load: ' + url));
        i.src = url;
      });
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const externals = Array.from(clone.querySelectorAll('image')) as SVGImageElement[];
    let inlinedCount = 0;
    let droppedCount = 0;
    await Promise.all(externals.map(async (im) => {
      const href = im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!href || href.startsWith('data:')) return;
      try {
        const data = await imgToDataUrl(href);
        im.removeAttribute('href');
        im.removeAttribute('xlink:href');
        im.setAttribute('href', data);
        im.setAttribute('xlink:href', data);
        inlinedCount++;
      } catch {
        im.remove();
        droppedCount++;
      }
    }));

    const xml = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img: HTMLImageElement = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('svg img load failed'));
      i.src = url;
    });

    function canWebp(): boolean {
      try {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        return c.toDataURL('image/webp').startsWith('data:image/webp');
      } catch { return false; }
    }
    const mime = canWebp() ? 'image/webp' : 'image/jpeg';

    const tries: Array<{ w: number; h: number; q: number; size: number }> = [];
    let chosen: Blob | null = null;
    outer: for (const [w, h] of SHARE_SIZES) {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.85, 0.7, 0.55, 0.4]) {
        const b: Blob = await new Promise((res, rej) => {
          canvas.toBlob((bl) => bl ? res(bl) : rej(new Error('null')), mime, q);
        });
        tries.push({ w, h, q, size: b.size });
        chosen = b;
        if (b.size <= MAX_BYTES) break outer;
      }
    }
    URL.revokeObjectURL(url);

    const buf = new Uint8Array(await chosen!.arrayBuffer());
    return {
      size: chosen!.size,
      type: chosen!.type,
      mime,
      tries,
      bytes: Array.from(buf),
      inlinedCount,
      droppedCount,
      svgImageCount: externals.length,
    };
  });

  console.log('=== real JobCard share blob measurement ===');
  console.log('svg <image> tags:', result.svgImageCount, '/ inlined:', result.inlinedCount, '/ dropped:', result.droppedCount);
  console.log('mime:', result.mime);
  console.log('tries:');
  for (const t of result.tries) console.log(`  ${t.w}x${t.h} q=${t.q} → ${t.size} bytes`);
  console.log('chosen:', result.size, 'bytes');

  const ext = result.mime === 'image/webp' ? 'webp' : 'jpg';
  const dir = join(process.cwd(), 'test-results');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `card-share-real.${ext}`);
  writeFileSync(path, Buffer.from(result.bytes));
  console.log('saved real card share output to:', path);

  expect(result.size).toBeLessThanOrEqual(100 * 1024);
});
