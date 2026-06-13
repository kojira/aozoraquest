/**
 * 投稿前の画像をクライアントで lossy WebP に圧縮する。
 *
 * Bluesky の uploadBlob は約 1MB 上限。元画像が大きいと従来は「大きすぎる」と
 * 拒否していたが、ここで canvas 経由で WebP 変換 + 必要なら段階的に画質/寸法を
 * 落として上限内に収める。
 *
 * - GIF はアニメーションを壊さないため変換しない (そのまま返す)
 * - EXIF 回転は createImageBitmap の imageOrientation:'from-image' で吸収
 * - canvas/WebP 非対応や失敗時は元 File をそのまま返す (呼び出し側で最終 size 検査)
 */

export interface CompressOptions {
  /** 目標の最大バイト数 (これ以下に収める) */
  maxBytes?: number;
  /** 長辺の最大ピクセル */
  maxDimension?: number;
  /** 試す画質 (高→低)。上から順に試して maxBytes 以下になったら採用 */
  qualitySteps?: number[];
  /** 出力 MIME (既定 image/webp) */
  mimeType?: string;
}

export interface CompressResult {
  blob: Blob;
  /** 圧縮したか (false = GIF / 非対応 / 失敗で元のまま) */
  compressed: boolean;
  originalBytes: number;
  width?: number;
  height?: number;
}

const DEFAULTS = {
  maxBytes: 950_000,
  maxDimension: 1920,
  qualitySteps: [0.85, 0.72, 0.6, 0.48, 0.38],
  mimeType: 'image/webp',
};

function canUseCanvasWebp(): boolean {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    // toDataURL が webp を返せれば対応 (Safari 14+ / Chrome / Firefox)
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

function drawTo(bitmap: ImageBitmap, w: number, h: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxDimension = opts.maxDimension ?? DEFAULTS.maxDimension;
  const qualitySteps = opts.qualitySteps ?? DEFAULTS.qualitySteps;
  const mimeType = opts.mimeType ?? DEFAULTS.mimeType;
  const originalBytes = file.size;

  // GIF はアニメ保持のため変換しない
  if (file.type === 'image/gif' || !canUseCanvasWebp()) {
    return { blob: file, compressed: false, originalBytes };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { blob: file, compressed: false, originalBytes };
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    let w = Math.max(1, Math.round(bitmap.width * scale));
    let h = Math.max(1, Math.round(bitmap.height * scale));
    let last: Blob | null = null;

    // 寸法を 2 段階まで落としつつ、各段で画質を上から試す
    for (let shrink = 0; shrink < 3; shrink++) {
      const canvas = drawTo(bitmap, w, h);
      if (!canvas) break;
      for (const q of qualitySteps) {
        const blob = await canvasToBlob(canvas, mimeType, q);
        if (!blob) continue;
        last = blob;
        if (blob.size <= maxBytes) {
          return { blob, compressed: true, originalBytes, width: w, height: h };
        }
      }
      // 全画質でも収まらない → 長辺を 0.7 倍に縮めて再挑戦
      w = Math.max(1, Math.round(w * 0.7));
      h = Math.max(1, Math.round(h * 0.7));
    }

    // 収まらなくても、元より小さければ webp を返す (呼び出し側が最終 size 検査)
    if (last && last.size < originalBytes) {
      return { blob: last, compressed: true, originalBytes };
    }
    return { blob: file, compressed: false, originalBytes };
  } finally {
    bitmap.close();
  }
}

/** webp blob 用のファイル名を作る (元名の拡張子を .webp に) */
export function webpFileName(original: string): string {
  return original.replace(/\.[^.]+$/, '') + '.webp';
}
