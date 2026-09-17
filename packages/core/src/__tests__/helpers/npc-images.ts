import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
/** Small original RGBA fixtures exported with Pillow; no image codec in test helpers. */
export function imageFixture(name: string): Buffer {
  return readFileSync(new URL(`../fixtures/npc-images/${name}`, import.meta.url));
}
export function png(width = 32, height = 32): Buffer {
  return imageFixture(`${width}x${height}.png`);
}
export function cidFor(bytes: Uint8Array): string {
  const raw = Buffer.concat([Buffer.from([1, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest()]);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let out = 'b', bits = 0, v = 0;
  for (const byte of raw) { v = (v << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(v >>> bits) & 31]; } }
  if (bits) out += alphabet[(v << (5 - bits)) & 31];
  return out;
}
