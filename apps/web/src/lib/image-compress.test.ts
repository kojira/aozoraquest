import { describe, it, expect } from 'vitest';
import { compressImage, isBlueskySupportedImageType, pickOutputType } from './image-compress';

// jsdom には createImageBitmap / canvas.toBlob('image/webp') が無いため、
// canvas 経路は通らず early-return (元 File を返す) になる。ここではその
// 「壊さない」分岐 (GIF スキップ / 非対応フォールバック) を検証する。
// 実際の WebP 変換は browser 専用なので実機 / e2e 側で確認する。

function fakeFile(type: string, bytes = 2_000_000): File {
  return new File([new Uint8Array(bytes)], 'x', { type });
}

describe('compressImage (jsdom: canvas 非対応で fallback)', () => {
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

describe('pickOutputType', () => {
  it('webp 希望 + 対応 → webp', () => {
    expect(pickOutputType(true, true)).toBe('image/webp');
  });
  it('webp 希望 + 非対応 (Safari) → jpeg にフォールバック', () => {
    expect(pickOutputType(true, false)).toBe('image/jpeg');
  });
  it('webp 非希望 → jpeg', () => {
    expect(pickOutputType(false, true)).toBe('image/jpeg');
  });
});
