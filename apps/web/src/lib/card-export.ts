/**
 * SVG カードを PNG blob に rasterize するユーティリティ。
 * Bluesky 投稿用・ダウンロード用の両方で使う。
 */

import type { Agent } from '@atproto/api';
import { createPostWithImage } from './atproto';

const OUTPUT_W = 1536;
const OUTPUT_H = 2144;
const EMBEDDED_MIME_FOR_ART = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/**
 * SVG 内の `<image href="/card-art/...">` 参照は、CanvasContext.drawImage で
 * rasterize するときに CORS / same-origin の制約が出る。Vite 同一 origin から
 * fetch → blob → dataURL 化して埋め込み、単一 SVG にしてから rasterize する。
 */
async function inlineImages(svgEl: SVGSVGElement): Promise<string> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const images = Array.from(clone.querySelectorAll('image'));
  await Promise.all(images.map(async (img) => {
    const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) return;
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`fetch ${href} ${res.status}`);
      const blob = await res.blob();
      const mime = blob.type || inferMimeFromExt(href);
      const dataUrl = await blobToDataUrl(blob, mime);
      img.removeAttribute('href');
      img.removeAttribute('xlink:href');
      img.setAttribute('href', dataUrl);
      img.setAttribute('xlink:href', dataUrl);
    } catch (e) {
      console.warn('[card-export] image inline failed', href, e);
    }
  }));
  return new XMLSerializer().serializeToString(clone);
}

function inferMimeFromExt(url: string): string {
  const lower = url.toLowerCase();
  for (const [ext, mime] of Object.entries(EMBEDDED_MIME_FOR_ART)) {
    if (lower.endsWith('.' + ext)) return mime;
  }
  return 'image/png';
}

function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]+/, `data:${mime}`));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('loadImage failed: ' + (e as ErrorEvent)?.message));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

/** SVG 要素を PNG Blob に変換する。 */
export async function cardToPngBlob(svgEl: SVGSVGElement): Promise<Blob> {
  const xml = await inlineImages(svgEl);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_W;
    canvas.height = OUTPUT_H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, OUTPUT_W, OUTPUT_H);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG Blob をブラウザで DL させる。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Bluesky に画像付きで投稿する。 */
export async function postCardToBluesky(
  agent: Agent,
  blob: Blob,
  text: string,
  alt: string,
): Promise<void> {
  await createPostWithImage(agent, text, blob, alt, 'AozoraQuest');
}
