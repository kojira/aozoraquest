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
