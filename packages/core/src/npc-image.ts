import { imageSize } from 'image-size';
import isAnimated from 'is-animated';

/** NPC upload contract. PNG and WebP are kept as their original bytes. */
export type NpcImageKind = 'sprite' | 'portrait';
export interface NpcImage {
  blob: { $type: 'blob'; ref: { $link: string }; mimeType: 'image/png' | 'image/webp'; size: number };
  width: number;
  height: number;
}
export const NPC_IMAGE_BYTES = { sprite: 100 * 1024, portrait: 1024 * 1024 } as const;
// PDS uploadBlob uses CIDv1/raw/sha256, encoded as lower-case base32.
export const NPC_IMAGE_CID = /^bafkre[a-z2-7]{53}$/;
export function assertNpcImageDimensions(width: number, height: number, kind: NpcImageKind): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    (kind === 'sprite' ? !([16, 32].includes(height) && (width === height || width === height * 2)) : width > 1024 || height > 1024)) {
    throw new Error(kind === 'sprite' ? 'マップ画像は16×16・32×32、または横2コマ32×16・64×32pxにしてください' : '会話イラストは各辺1〜1024pxにしてください');
  }
}
export function assertNpcImage(value: unknown, kind: NpcImageKind): asserts value is NpcImage {
  const image = value as NpcImage | null;
  if (!image || typeof image !== 'object' || image.blob?.$type !== 'blob' ||
    typeof image.blob.ref?.$link !== 'string' || !NPC_IMAGE_CID.test(image.blob.ref.$link) ||
    !['image/png', 'image/webp'].includes(image.blob.mimeType) || !Number.isInteger(image.blob.size) || image.blob.size < 1 || image.blob.size > NPC_IMAGE_BYTES[kind]) {
    throw new Error('NPC画像の参照・形式・容量が不正です');
  }
  assertNpcImageDimensions(image.width, image.height, kind);
}

/** Read a bounded stream, cancelling before accumulating beyond the limit. */
export async function readNpcImageBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('画像の容量・展開サイズが上限を超えています');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** Format/dimensions only; full image decoding belongs to the browser, not a custom codec. */
export function inspectNpcImage(bytes: Uint8Array, kind: NpcImageKind): { width: number; height: number; mimeType: NpcImage['blob']['mimeType'] } {
  if (!bytes.length || bytes.length > NPC_IMAGE_BYTES[kind]) throw new Error('画像のファイル容量が上限を超えています');
  let dimensions: ReturnType<typeof imageSize>;
  try { dimensions = imageSize(bytes); }
  catch { throw new Error('画像を読み込めません。PNG・WebPの画像を選んでください'); }
  const { width, height, type } = dimensions;
  if (type !== 'png' && type !== 'webp') throw new Error('PNG・WebPの画像を選んでください');
  assertNpcImageDimensions(width, height, kind);
  if (isAnimated(Uint8Array.from(bytes).buffer)) throw new Error('ファイル内アニメには対応していません。静止画像か横2コマのPNG・WebPを選んでください');
  return { width, height, mimeType: type === 'png' ? 'image/png' : 'image/webp' };
}
