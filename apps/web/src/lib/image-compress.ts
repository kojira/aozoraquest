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
 * - EXIF 回転は createImageBitmap の imageOrientation:'from-image' で吸収。
 *   img フォールバック時はブラウザ既定の image-orientation:from-image で吸収。
 * - **デコードは createImageBitmap → 失敗時 <img> の 2 段**。Android Chrome は
 *   端末メモリ次第で高解像度カメラ JPEG (12〜64MP) の createImageBitmap が
 *   reject することがある (= 4 枚連続添付すると後半が落ちる)。その時に元 File を
 *   返すと「圧縮されず素のサイズで上限超過 → 投稿弾かれ」になるため、<img> +
 *   decode() の別経路でデコードし、必ず再エンコードまで到達させる。
 * - 両経路とも失敗 / canvas 非対応時のみ元 File を返す (呼び出し側で最終 size 検査)
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
function drawTo(source: CanvasImageSource, w: number, h: number, outType: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (outType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** デコード結果 (createImageBitmap か <img>)。再エンコードの draw に使う共通形。 */
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

/** <img> + decode() でデコードする (createImageBitmap が使えない/失敗した時の退避)。
 *  Android Chrome で高解像度 JPEG の createImageBitmap が reject するケースを救う。
 *  EXIF 回転はブラウザ既定の image-orientation:from-image が効く。 */
function decodeViaImgElement(file: File): Promise<DecodedImage | null> {
  if (typeof Image === 'undefined' || typeof URL === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(url);
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) {
        cleanup();
        resolve(null);
        return;
      }
      resolve({ source: img, width, height, cleanup });
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };
    img.src = url;
  });
}

/** createImageBitmap (EXIF 吸収・HEIC 対応) を優先し、失敗したら <img> に退避する。 */
async function decodeImage(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== 'undefined') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch (e) {
      // Android Chrome のメモリ起因 reject 等。<img> 経路に退避する。
      console.warn('[image-compress] createImageBitmap 失敗、<img> 経路に退避', e);
    }
  }
  return decodeViaImgElement(file);
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

/** WASM encode はメインスレッドで重い。試行回数を抑えるため画質ステップを
 *  短くする (ネイティブ/JPEG の 5 段に対し 3 段)。 */
const WASM_QUALITY_STEPS = [0.82, 0.6, 0.42];

/** 出力形式とエンコーダを決める。heavy=true は WASM 経路 (encode が重い)。
 *  - WebP 希望 + canvas ネイティブ対応 (Chrome) → ネイティブ WebP (高速)
 *  - WebP 希望 + 非対応 (Safari) → WASM WebP。ロード失敗時のみ JPEG
 *  - それ以外 → JPEG */
async function chooseEncoder(wantWebp: boolean): Promise<{ outType: string; encode: Encoder; heavy: boolean }> {
  if (wantWebp && supportsWebpEncode()) {
    return { outType: 'image/webp', encode: (c, q) => canvasToBlob(c, 'image/webp', q), heavy: false };
  }
  if (wantWebp) {
    const wasm = await loadWasmWebpEncode();
    if (wasm) {
      return {
        outType: 'image/webp',
        heavy: true,
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
  return { outType: 'image/jpeg', encode: (c, q) => canvasToBlob(c, 'image/jpeg', q), heavy: false };
}

/** 指定エンコーダで「寸法 × 画質」を試し、maxBytes 以下になる最良 (fit) を返す。
 *  encode が throw しても握りつぶして null 扱いにする (堅牢性)。
 *  fit する blob が無ければ「最小だが超過」の best を返し、1 枚も作れなければ null。 */
async function encodeBestFit(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  outType: string,
  encode: Encoder,
  maxBytes: number,
  maxDimension: number,
  qualitySteps: number[],
): Promise<{ blob: Blob; w: number; h: number; fit: boolean } | null> {
  const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
  let w = Math.max(1, Math.round(srcWidth * scale));
  let h = Math.max(1, Math.round(srcHeight * scale));
  let best: { blob: Blob; w: number; h: number; fit: boolean } | null = null;

  // 初期寸法 + 最大 2 回の縮小 (計 3 サイズ) を試し、各サイズで画質を上から試す
  for (let shrink = 0; shrink < 3; shrink++) {
    const canvas = drawTo(source, w, h, outType);
    if (!canvas) break;
    for (const q of qualitySteps) {
      let blob: Blob | null = null;
      try {
        blob = await encode(canvas, q);
      } catch (e) {
        console.warn('[image-compress] encode に失敗', e);
      }
      // size 0 (壊れた encode 結果) は採用しない
      if (!blob || blob.size === 0) continue;
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
  const { outType, encode, heavy } = await chooseEncoder(wantWebp);
  // WASM 経路 (heavy) はメインスレッド負荷が高いので試行回数を減らす
  const primarySteps = heavy && !opts.qualitySteps ? WASM_QUALITY_STEPS : qualitySteps;

  // createImageBitmap (EXIF/HEIC) 優先、ダメなら <img> に退避してでもデコードする。
  // ここで null = どの経路でもデコードできなかった (= 元 File を返すしかない)。
  const decoded = await decodeImage(file);
  if (!decoded) {
    // HEIC を <img> でも decode できない環境 (例: デスクトップ Chrome) 等
    return { blob: file, compressed: false, originalBytes };
  }
  const { source, width: srcW, height: srcH } = decoded;

  try {
    let usedType = outType;
    let result = await encodeBestFit(source, srcW, srcH, outType, encode, maxBytes, maxDimension, primarySteps);

    // WebP エンコーダが 1 枚も作れなかった (WASM ロード/実行失敗等) 場合は
    // JPEG に退避する。これで「これまで動いていた JPEG 圧縮」を絶対に壊さない。
    if (!result && outType !== 'image/jpeg') {
      usedType = 'image/jpeg';
      result = await encodeBestFit(
        source, srcW, srcH, 'image/jpeg', (c, q) => canvasToBlob(c, 'image/jpeg', q), maxBytes, maxDimension, qualitySteps,
      );
    }

    if (result && result.fit) {
      return { blob: result.blob, compressed: true, originalBytes, outputType: usedType, width: result.w, height: result.h };
    }
    // 収まらなくても、元より小さければ返す (呼び出し側が最終 size 検査)
    if (result && result.blob.size < originalBytes) {
      return { blob: result.blob, compressed: true, originalBytes, outputType: usedType, width: result.w, height: result.h };
    }
    return { blob: file, compressed: false, originalBytes };
  } finally {
    decoded.cleanup();
  }
}
