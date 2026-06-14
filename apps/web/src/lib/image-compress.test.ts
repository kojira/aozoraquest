import { afterEach, describe, it, expect, vi } from 'vitest';
import { compressImage, isBlueskySupportedImageType } from './image-compress';

// vitest は node 環境 (DOM 無し)。createImageBitmap / canvas.toBlob が無い素の状態では
// canvas 経路は通らず early-return (元 File を返す) になる。まずその「壊さない」分岐を検証。
// canvas / createImageBitmap / Image をスタブした分岐 (= 実ブラウザ相当の制御フロー) は後段で検証する。
// 実際の WebP 変換品質は browser 専用なので実機 / Playwright 側で確認する。

function fakeFile(type: string, bytes = 2_000_000): File {
  return new File([new Uint8Array(bytes)], 'x', { type });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('compressImage (DOM 非対応で fallback)', () => {
  it('GIF はアニメ保持のため変換せず元 File を返す', async () => {
    const f = fakeFile('image/gif');
    const r = await compressImage(f);
    expect(r.compressed).toBe(false);
    expect(r.blob).toBe(f);
    expect(r.originalBytes).toBe(f.size);
  });

  it('canvas/WebP 非対応環境では元 File をそのまま返す (壊さない)', async () => {
    const f = fakeFile('image/png');
    const r = await compressImage(f);
    expect(r.compressed).toBe(false);
    expect(r.blob).toBe(f);
  });
});

// fit する小さい blob を必ず返す fake canvas (toBlob は ~100KB を返す)
function installCanvasStub() {
  const FIT_BYTES = 100_000;
  const fakeCtx = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })),
  };
  const createElement = vi.fn((tag: string) => {
    if (tag !== 'canvas') throw new Error(`unexpected createElement(${tag})`);
    return {
      width: 0,
      height: 0,
      getContext: () => fakeCtx,
      // supportsWebpEncode() が true を返すよう webp を申告 → ネイティブ WebP 経路
      toDataURL: (type: string) => `data:${type};base64,xxx`,
      toBlob: (cb: (b: Blob | null) => void, type: string) => {
        cb(new Blob([new Uint8Array(FIT_BYTES)], { type }));
      },
    };
  });
  vi.stubGlobal('document', { createElement });
}

function stubUrl() {
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:fake', revokeObjectURL: vi.fn() });
}

/**
 * 本丸: Android Chrome は端末メモリ次第で高解像度カメラ JPEG (12〜64MP) の
 * createImageBitmap が reject することがある。その時に元 File を返すと「圧縮されず
 * 素のサイズで上限超過 → 投稿弾かれ」になるため、<img> 経路に退避して必ず圧縮まで
 * 到達させる。ここではその制御フローをスタブで検証する。
 */
describe('compressImage decode fallback', () => {
  it('createImageBitmap が reject しても <img> 経路で圧縮まで到達する', async () => {
    installCanvasStub();
    stubUrl();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('forced reject'))));

    const imgInstances: Array<{ src: string }> = [];
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4080;
      naturalHeight = 3072;
      _src = '';
      set src(v: string) {
        this._src = v;
        imgInstances.push(this);
        queueMicrotask(() => this.onload?.()); // 実ブラウザの decode 同様に非同期で発火
      }
      get src() {
        return this._src;
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);

    const r = await compressImage(fakeFile('image/jpeg', 4_000_000), { maxBytes: 950_000 });

    expect(r.compressed).toBe(true); // 元 File にフォールバックしていない
    expect(r.blob.size).toBeLessThanOrEqual(950_000);
    expect(imgInstances.length).toBeGreaterThan(0); // <img> 経路を実際に通った
  });

  it('createImageBitmap が存在しない環境でも <img> 経路で圧縮する (早期 return しない)', async () => {
    installCanvasStub();
    stubUrl();
    // createImageBitmap 自体が未定義 (古い WebView 等)。早期 return せず <img> に退避する想定。
    vi.stubGlobal('createImageBitmap', undefined);
    let used = false;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4080;
      naturalHeight = 3072;
      decode = () => Promise.resolve();
      set src(_v: string) {
        used = true;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);

    const r = await compressImage(fakeFile('image/jpeg', 4_000_000), { maxBytes: 950_000 });

    expect(r.compressed).toBe(true);
    expect(r.blob.size).toBeLessThanOrEqual(950_000);
    expect(used).toBe(true);
  });

  it('createImageBitmap 成功時は <img> を使わず bitmap を後始末する', async () => {
    installCanvasStub();
    stubUrl();
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width: 4080, height: 3072, close })),
    );
    const ImageCtor = vi.fn();
    vi.stubGlobal('Image', ImageCtor as unknown as typeof Image);

    const r = await compressImage(fakeFile('image/jpeg', 4_000_000), { maxBytes: 950_000 });

    expect(r.compressed).toBe(true);
    expect(r.blob.size).toBeLessThanOrEqual(950_000);
    expect(ImageCtor).not.toHaveBeenCalled(); // 成功時は <img> を使わない
    expect(close).toHaveBeenCalled(); // bitmap を後始末している
  });

  it('両方の decode 経路が失敗したら元 File を返す (壊さない)', async () => {
    installCanvasStub();
    stubUrl();
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('reject'))));
    class FailImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailImage as unknown as typeof Image);

    const f = fakeFile('image/jpeg', 4_000_000);
    const r = await compressImage(f, { maxBytes: 950_000 });

    expect(r.compressed).toBe(false);
    expect(r.blob).toBe(f);
  });
});

describe('isBlueskySupportedImageType', () => {
  it('jpeg/png/webp/gif は対応', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      expect(isBlueskySupportedImageType(t)).toBe(true);
    }
  });
  it('HEIC / 空 / 非画像は非対応 (= 変換できなければ投稿不可にする)', () => {
    for (const t of ['image/heic', 'image/heif', '', 'application/pdf', 'image/svg+xml']) {
      expect(isBlueskySupportedImageType(t)).toBe(false);
    }
  });
});
