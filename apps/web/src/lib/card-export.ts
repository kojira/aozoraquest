/**
 * SVG カードを PNG blob に rasterize するユーティリティ。
 * Bluesky 投稿用・ダウンロード用の両方で使う。
 */

import type { Agent } from '@atproto/api';
import { createPostWithImage } from './atproto';

/** ダウンロード用 PNG の出力サイズ。印刷でも耐える解像度。 */
const DOWNLOAD_W = 1536;
const DOWNLOAD_H = 2144;
/** Bluesky 投稿用の出力サイズ。100KB 以下に収めやすく、表示でも十分な解像度。 */
const SHARE_W = 1024;
const SHARE_H = 1430;
const EMBEDDED_MIME_FOR_ART = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/**
 * SVG 内の外部 <image href="..."> を全て data URL に inline し、rasterize 時に
 * CORS で失敗しないようにする。
 *
 * 従来は fetch → blob → FileReader.readAsDataURL を使っていたが、Bluesky CDN
 * (cdn.bsky.app 等) のアバター URL に対して CORS が効かず結果が壊れるケース
 * があった。ブラウザ標準の <img crossOrigin="anonymous"> + canvas.toDataURL
 * のパターンの方が一般的なので、こちらに統一する。
 */
async function imageToDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 512;
        canvas.height = img.naturalHeight || 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no 2d context')); return; }
        ctx.drawImage(img, 0, 0);
        // toDataURL は CORS tainted canvas で SecurityError を投げる。その場合は reject。
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

async function inlineImages(svgEl: SVGSVGElement): Promise<string> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const images = Array.from(clone.querySelectorAll('image'));
  await Promise.all(images.map(async (imgEl) => {
    const href = imgEl.getAttribute('href')
      || imgEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!href || href.startsWith('data:')) return;
    try {
      const dataUrl = await imageToDataUrl(href);
      imgEl.removeAttribute('href');
      imgEl.removeAttribute('xlink:href');
      imgEl.setAttribute('href', dataUrl);
      imgEl.setAttribute('xlink:href', dataUrl);
    } catch (e) {
      console.warn('[card-export] image inline failed', href, e);
      // 失敗した <image> は削除: 壊れた外部画像のまま rasterize すると
      // canvas が tainted になって blob 書き出しが死ぬ。
      imgEl.remove();
    }
  }));
  return new XMLSerializer().serializeToString(clone);
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

/** SVG を指定サイズの canvas に描画して返す。圧縮処理の共通前処理。 */
async function rasterizeSvg(svgEl: SVGSVGElement, w: number, h: number): Promise<HTMLCanvasElement> {
  const xml = await inlineImages(svgEl);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** SVG 要素を PNG Blob に変換する (ダウンロード用、フル解像度)。 */
export async function cardToPngBlob(svgEl: SVGSVGElement): Promise<Blob> {
  const canvas = await rasterizeSvg(svgEl, DOWNLOAD_W, DOWNLOAD_H);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob returned null'));
    }, 'image/png');
  });
}

/** ブラウザが image/webp の canvas エンコードに対応しているか。
 *  Safari は古いバージョンで未対応だったため、フォールバック判定が要る。 */
function canvasEncodesWebp(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`toBlob(${mime}) returned null`));
    }, mime, quality);
  });
}

/** SVG 要素を Bluesky 投稿用に圧縮した Blob にする。
 *  既定で 100KB 以下を狙う。WebP が使えれば WebP、ダメなら JPEG にフォールバック。
 *  目標サイズに収まるまで quality を下げる (0.85 → 0.5)。 */
export async function cardToShareBlob(
  svgEl: SVGSVGElement,
  opts: { maxBytes?: number } = {},
): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? 100 * 1024;
  const canvas = await rasterizeSvg(svgEl, SHARE_W, SHARE_H);
  const mime = canvasEncodesWebp() ? 'image/webp' : 'image/jpeg';
  const qualities = [0.85, 0.78, 0.7, 0.62, 0.55, 0.5];
  let last: Blob | null = null;
  for (const q of qualities) {
    const blob = await canvasToBlob(canvas, mime, q);
    last = blob;
    if (blob.size <= maxBytes) return blob;
  }
  // それでも超えるなら quality 0.5 の最終結果を返す (この後も大きいなら諦め)
  if (last) return last;
  throw new Error('cardToShareBlob: unable to encode');
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
