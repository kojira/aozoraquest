import type { Agent } from '@atproto/api';
import { assertNpcImage, assertNpcImageDimensions, inspectNpcImage, NPC_IMAGE_BYTES, type NpcImage, type NpcImageKind } from '@aozoraquest/core';
import { getPrimaryAdminDid } from './runtime-config';
import { EDGE_URL } from './edge-config';

export interface PreparedNpcImage { image: NpcImage; blob: Blob; url: string; uploaded?: NpcImage }
let webpEncoder: Promise<typeof import('@jsquash/webp/encode').default> | undefined;
function loadWebpEncoder() {
  return webpEncoder ??= Promise.all([
    import('@jsquash/webp/encode'),
    import('@jsquash/webp/codec/enc/webp_enc.wasm?url'),
    import('@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'),
  ]).then(async ([encoder, plain, simd]) => {
    // Explicit Vite asset URLs work both in dependency-optimized dev and hashed production builds.
    await encoder.init({ locateFile: (file: string) => file.endsWith('webp_enc_simd.wasm') ? simd.default : plain.default });
    return encoder.default;
  }).catch((error) => { webpEncoder = undefined; throw error; });
}
export function npcImageUrl(id: string, kind: NpcImageKind, image: NpcImage): string {
  return `${EDGE_URL ?? ''}/api/npc-image?${new URLSearchParams({ npcId: id, kind, cid: image.blob.ref.$link })}`;
}
async function rawCid(blob: Blob): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  const bytes = new Uint8Array([1, 0x55, 0x12, 0x20, ...hash]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0, value = 0, out = 'b';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export async function prepareNpcImage(file: File, kind: NpcImageKind): Promise<PreparedNpcImage> {
  if (!file.size || file.size > NPC_IMAGE_BYTES[kind]) throw new Error(`画像は${kind === 'sprite' ? '100KiB' : '1MiB'}以下にしてください`);
  const info = inspectNpcImage(new Uint8Array(await file.arrayBuffer()), kind);
  const source = new Blob([file], { type: info.mimeType });
  const input = URL.createObjectURL(source);
  try {
    const decoded = new Image(); decoded.src = input;
    await decoded.decode().catch(() => { throw new Error('画像を読み込めません。画像が壊れていないか確認してください'); });
    const width = decoded.naturalWidth, height = decoded.naturalHeight;
    assertNpcImageDimensions(width, height, kind);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('画像を処理できません');
    ctx.drawImage(decoded, 0, 0);
    // Existing WASM/libwebp encoder also works when Safari cannot encode WebP via canvas.
    // quality: 100 alone is NOT lossless; sprite pixels explicitly use lossless: 1.
    const encode = await loadWebpEncoder();
    const encoded = await encode(ctx.getImageData(0, 0, width, height), kind === 'sprite'
      ? { lossless: 1, exact: 1, quality: 100, near_lossless: 100 }
      : { quality: 85, alpha_quality: 100 });
    const converted = new Blob([encoded], { type: 'image/webp' });
    // Already-small WebP needs no additional loss or larger file. It may retain original metadata.
    const blob = info.mimeType === 'image/webp' && source.size <= converted.size && width === info.width && height === info.height ? source : converted;
    const output = inspectNpcImage(new Uint8Array(await blob.arrayBuffer()), kind);
    if (output.mimeType !== 'image/webp' || output.width !== width || output.height !== height) throw new Error('WebPへの変換結果が不正です');
    const image: NpcImage = { width, height, blob: { $type: 'blob', ref: { $link: await rawCid(blob) }, mimeType: 'image/webp', size: blob.size } };
    assertNpcImage(image, kind);
    return { image, blob, url: URL.createObjectURL(blob) };
  } finally { URL.revokeObjectURL(input); }
}
export async function uploadNpcImage(agent: Agent, prepared: PreparedNpcImage, kind: NpcImageKind): Promise<NpcImage> {
  if (agent.assertDid !== getPrimaryAdminDid()) throw new Error('画像の保存は主管理者本人だけが行えます');
  if (prepared.uploaded) return prepared.uploaded;
  const result = await agent.uploadBlob(prepared.blob, { encoding: prepared.image.blob.mimeType });
  const blob = JSON.parse(JSON.stringify(result.data.blob)) as NpcImage['blob'];
  const image = { ...prepared.image, blob };
  assertNpcImage(image, kind);
  if (blob.ref.$link !== prepared.image.blob.ref.$link || blob.size !== prepared.blob.size || blob.mimeType !== prepared.image.blob.mimeType) throw new Error('アップロード結果が選んだ画像と一致しません');
  prepared.uploaded = image;
  return image;
}
