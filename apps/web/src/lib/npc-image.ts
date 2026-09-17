import type { Agent } from '@atproto/api';
import { assertNpcImage, assertNpcImageDimensions, inspectNpcImage, NPC_IMAGE_BYTES, type NpcImage, type NpcImageKind } from '@aozoraquest/core';
import { getPrimaryAdminDid } from './runtime-config';
import { EDGE_URL } from './edge-config';

export interface PreparedNpcImage { image: NpcImage; blob: Blob; url: string; uploaded?: NpcImage }
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
  const blob = new Blob([file], { type: info.mimeType });
  const input = URL.createObjectURL(blob);
  try {
    const decoded = new Image(); decoded.src = input;
    await decoded.decode().catch(() => { throw new Error('画像を読み込めません。画像が壊れていないか確認してください'); });
    const width = decoded.naturalWidth, height = decoded.naturalHeight;
    assertNpcImageDimensions(width, height, kind);
    const image: NpcImage = { ...info, blob: { $type: 'blob', ref: { $link: await rawCid(blob) }, mimeType: info.mimeType, size: blob.size } };
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
