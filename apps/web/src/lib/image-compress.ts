/**
 * 投稿前の画像をクライアントで圧縮する (lossy WebP 優先、非対応なら JPEG)。
 *
 * Bluesky の uploadBlob は約 1MB 上限。元画像が大きいと従来は「大きすぎる」と
 * 拒否していたが、ここで canvas 経由で再エンコード + 必要なら段階的に画質/寸法を
 * 落として上限内に収める。
 *
 * - **出力形式**: WebP エンコード対応ブラウザ (Chrome 等) は WebP。
 *   **iOS Safari は canvas の WebP エンコード非対応**なので JPEG に自動フォールバック
 *   (これをしないと Safari で圧縮できず iPhone 写真が投稿できない)。
 * - **入力**: jpeg/png/webp に加え、iPhone の **HEIC/HEIF** も受ける。Safari は
 *   createImageBitmap で HEIC をデコードできるので、canvas 経由で jpeg/webp に
 *   再エンコードして投稿可能にする。
 * - GIF はアニメーションを壊さないため変換しない (そのまま返す)
 * - EXIF 回転は createImageBitmap の imageOrientation:'from-image' で吸収
 * - createImageBitmap や canvas が使えない/失敗時は元 File を返す
 *   (呼び出し側で最終 size 検査)
 */

export interface CompressOptions {
  /** 目標の最大バイト数 (これ以下に収める) */
  maxBytes?: number;
  /** 長辺の最大ピクセル */
  maxDimension?: number;
  /** 試す画質 (高→低)。上から順に試して maxBytes 以下になったら採用 */
  qualitySteps?: number[];
  /** 希望出力 MIME (既定 image/webp)。非対応なら image/jpeg にフォールバック */
  mimeType?: string;
}

export interface CompressResult {
  blob: Blob;
  /** 圧縮したか (false = GIF / 非対応 / 失敗で元のまま) */
  compressed: boolean;
  originalBytes: number;
  /** 実際の出力 MIME (compressed=true のとき) */
  outputType?: string;
  width?: number;
  height?: number;
}

const DEFAULTS = {
  maxBytes: 950_000,
  maxDimension: 1920,
  qualitySteps: [0.85, 0.72, 0.6, 0.48, 0.38],
  mimeType: 'image/webp',
};

/** Bluesky の app.bsky.embed.images が受け付ける画像形式。
 *  HEIC はここに無いので、HEIC のまま uploadBlob すると表示不能になる。 */
export const BLUESKY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** その MIME が Bluesky にそのまま投稿できる形式か。 */
export function isBlueskySupportedImageType(type: string): boolean {
  return BLUESKY_IMAGE_TYPES.includes(type);
}

/** canvas が WebP エンコードに対応しているか (Safari は非対応 → WASM か JPEG に倒す) */
function supportsWebpEncode(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

/** outType が jpeg のときは透過部分が黒くならないよう白背景を敷く */
function drawTo(bitmap: ImageBitmap, w: number, h: number, outType: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

/** canvas を quality (0-1) で Blob にエンコードする関数。 */
type Encoder = (canvas: HTMLCanvasElement, quality: number) => Promise<Blob | null>;

// WASM WebP エンコーダ (@jsquash/webp) は添付時に 1 回だけ動的 import する。
// canvas が WebP を吐けないブラウザ (iOS Safari) でも WebP を出すため。
let wasmWebpPromise: Promise<((d: ImageData, q: number) => Promise<ArrayBuffer>) | null> | null = null;
function loadWasmWebpEncode() {
  if (!wasmWebpPromise) {
    wasmWebpPromise = import('@jsquash/webp/encode')
      .then((m) => {
        const enc = m.default;
        return (data: ImageData, q: number) => enc(data, { quality: q });
      })
      .catch((e) => {
        console.warn('[image-compress] WASM WebP エンコーダのロードに失敗 (JPEG に倒す)', e);
        return null;
      });
  }
  return wasmWebpPromise;
}

/** 出力形式とエンコーダを決める。
 *  - WebP 希望 + canvas ネイティブ対応 (Chrome) → ネイティブ WebP (高速)
 *  - WebP 希望 + 非対応 (Safari) → WASM WebP。ロード失敗時のみ JPEG
 *  - それ以外 → JPEG */
async function chooseEncoder(wantWebp: boolean): Promise<{ outType: string; encode: Encoder }> {
  if (wantWebp && supportsWebpEncode()) {
    return { outType: 'image/webp', encode: (c, q) => canvasToBlob(c, 'image/webp', q) };
  }
  if (wantWebp) {
    const wasm = await loadWasmWebpEncode();
    if (wasm) {
      return {
        outType: 'image/webp',
        encode: async (c, q) => {
          const ctx = c.getContext('2d');
          if (!ctx) return null;
          const id = ctx.getImageData(0, 0, c.width, c.height);
          const buf = await wasm(id, Math.round(q * 100));
          return new Blob([buf], { type: 'image/webp' });
        },
      };
    }
  }
  return { outType: 'image/jpeg', encode: (c, q) => canvasToBlob(c, 'image/jpeg', q) };
}

/** 指定エンコーダで「寸法 × 画質」を試し、maxBytes 以下になる最良 (fit) を返す。
 *  encode が throw しても握りつぶして null 扱いにする (堅牢性)。
 *  fit する blob が無ければ「最小だが超過」の best を返し、1 枚も作れなければ null。 */
async function encodeBestFit(
  bitmap: ImageBitmap,
  outType: string,
  encode: Encoder,
  maxBytes: number,
  maxDimension: number,
  qualitySteps: number[],
): Promise<{ blob: Blob; w: number; h: number; fit: boolean } | null> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  let w = Math.max(1, Math.round(bitmap.width * scale));
  let h = Math.max(1, Math.round(bitmap.height * scale));
  let best: { blob: Blob; w: number; h: number; fit: boolean } | null = null;

  // 初期寸法 + 最大 2 回の縮小 (計 3 サイズ) を試し、各サイズで画質を上から試す
  for (let shrink = 0; shrink < 3; shrink++) {
    const canvas = drawTo(bitmap, w, h, outType);
    if (!canvas) break;
    for (const q of qualitySteps) {
      let blob: Blob | null = null;
      try {
        blob = await encode(canvas, q);
      } catch (e) {
        console.warn('[image-compress] encode に失敗', e);
      }
      if (!blob) continue;
      if (blob.size <= maxBytes) return { blob, w, h, fit: true };
      if (!best || blob.size < best.blob.size) best = { blob, w, h, fit: false };
    }
    w = Math.max(1, Math.round(w * 0.7));
    h = Math.max(1, Math.round(h * 0.7));
  }
  return best;
}

export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxDimension = opts.maxDimension ?? DEFAULTS.maxDimension;
  const qualitySteps = opts.qualitySteps ?? DEFAULTS.qualitySteps;
  const originalBytes = file.size;

  // GIF はアニメ保持のため変換しない
  if (file.type === 'image/gif') {
    return { blob: file, compressed: false, originalBytes };
  }
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return { blob: file, compressed: false, originalBytes };
  }

  // WebP 希望: ネイティブ(Chrome)→ WASM(Safari)→ JPEG の順でエンコーダを選ぶ
  const wantWebp = (opts.mimeType ?? DEFAULTS.mimeType) === 'image/webp';
  const { outType, encode } = await chooseEncoder(wantWebp);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // HEIC を decode できない環境 (例: デスクトップ Chrome) 等
    return { blob: file, compressed: false, originalBytes };
  }

  try {
    let usedType = outType;
    let result = await encodeBestFit(bitmap, outType, encode, maxBytes, maxDimension, qualitySteps);

    // WebP エンコーダが 1 枚も作れなかった (WASM ロード/実行失敗等) 場合は
    // JPEG に退避する。これで「これまで動いていた JPEG 圧縮」を絶対に壊さない。
    if (!result && outType !== 'image/jpeg') {
      usedType = 'image/jpeg';
      result = await encodeBestFit(
        bitmap, 'image/jpeg', (c, q) => canvasToBlob(c, 'image/jpeg', q), maxBytes, maxDimension, qualitySteps,
      );
    }

    if (result && result.fit) {
      return { blob: result.blob, compressed: true, originalBytes, outputType: usedType, width: result.w, height: result.h };
    }
    // 収まらなくても、元より小さければ返す (呼び出し側が最終 size 検査)
    if (result && result.blob.size < originalBytes) {
      return { blob: result.blob, compressed: true, originalBytes, outputType: usedType };
    }
    return { blob: file, compressed: false, originalBytes };
  } finally {
    bitmap.close();
  }
}
