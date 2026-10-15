import { describe, expect, it } from 'vitest';
import { assertNpcImage, inspectNpcImage, type NpcImage } from '../npc-image.js';
import { validateNpcs } from '../npc-data.js';
import { png, imageFixture, cidFor } from './helpers/npc-images.js';

describe('NPC image PNG/WebP contract', () => {
  it('accepts sprite sheets, transparent images, portraits and legacy NPCs', () => {
    for (const name of ['16x16.png', '32x32.png', '32x16.png', '64x32.png', '32x32.webp', '64x32.webp']) {
      const bytes = imageFixture(name);
      const { width, height, mimeType } = inspectNpcImage(bytes, 'sprite');
      const image: NpcImage = { width, height, blob: { $type: 'blob', ref: { $link: cidFor(bytes) }, mimeType, size: bytes.length } };
      expect(() => assertNpcImage(image, 'sprite')).not.toThrow();
      expect(mimeType).toBe(name.endsWith('webp') ? 'image/webp' : 'image/png');
      expect(() => validateNpcs([{ id: 'image', name: 'NPC', x: 0, y: 0, lines: ['hello'], spriteImage: image }])).not.toThrow();
    }
    expect(inspectNpcImage(png(512, 768), 'portrait')).toEqual({ width: 512, height: 768, mimeType: 'image/png' });
    expect(() => validateNpcs([{ id: 'old', name: 'NPC', x: 0, y: 0, lines: ['hello'] }])).not.toThrow();
  });
  it('rejects bad references, unsupported images, oversized dimensions/bytes and file animation', () => {
    expect(() => assertNpcImage({ blob: { $type: 'blob', ref: { $link: 'https://attacker.example/a.svg' }, mimeType: 'image/png', size: 50 }, width: 16, height: 16 }, 'sprite')).toThrow();
    for (const bytes of [png(48, 32), imageFixture('animated.png'), imageFixture('animated.webp'), Buffer.from('<svg onload="alert(1)"/>'), Buffer.alloc(102401)]) {
      expect(() => inspectNpcImage(bytes, 'sprite')).toThrow();
    }
    expect(() => inspectNpcImage(png(1025, 1), 'portrait')).toThrow();
  });
});
