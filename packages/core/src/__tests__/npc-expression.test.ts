import { describe, expect, it } from 'vitest';
import { npcExpressionImage, parseNpcLine, validateNpcs, type NpcDef } from '../npc-data.js';
import type { NpcImage } from '../npc-image.js';
import { cidFor, png } from './helpers/npc-images.js';

// D-DIALOGUE-005: a leading `[tag]` picks the line's expression portrait and is never displayed.
const image = (w = 512, h = 768): NpcImage => {
  const bytes = png(w, h);
  return { width: w, height: h, blob: { $type: 'blob', ref: { $link: cidFor(bytes) }, mimeType: 'image/png', size: bytes.length } };
};
const npc = (patch: Partial<NpcDef> = {}): NpcDef => ({ id: 'n', name: 'NPC', x: 0, y: 0, lines: ['hello'], ...patch });

describe('parseNpcLine', () => {
  it('strips only one leading lowercase tag and keeps the expression name', () => {
    expect(parseNpcLine('[sad]おにいちゃんが……')).toEqual({ expression: 'sad', text: 'おにいちゃんが……' });
    expect(parseNpcLine('[smile][sad]やあ')).toEqual({ expression: 'smile', text: '[sad]やあ' });
    expect(parseNpcLine('やあ')).toEqual({ text: 'やあ' });
    for (const raw of ['やあ[sad]', '[Sad]やあ', '[sad2]やあ', ' [sad]やあ', '[]やあ']) expect(parseNpcLine(raw)).toEqual({ text: raw });
  });
});

describe('npcExpressionImage', () => {
  it('returns only an own registered expression image', () => {
    const sad = image();
    const n = npc({ portraitImage: image(), expressionImages: { sad } });
    expect(npcExpressionImage(n, 'sad')).toBe(sad);
    expect(npcExpressionImage(n, 'smile')).toBeUndefined();
    expect(npcExpressionImage(n, undefined)).toBeUndefined();
    expect(npcExpressionImage(n, 'constructor')).toBeUndefined();
    expect(npcExpressionImage(npc(), 'sad')).toBeUndefined();
  });
});

describe('validateNpcs expressionImages', () => {
  it('accepts portrait-rule images keyed by tag names and tagged lines', () => {
    expect(() => validateNpcs([npc({ expressionImages: { sad: image() }, lines: ['[sad]かなしい', 'ふつう'] })])).not.toThrow();
  });
  it('rejects bad tag names, bad images and lines that are only a tag', () => {
    expect(() => validateNpcs([npc({ expressionImages: { Sad: image() } })])).toThrow();
    expect(() => validateNpcs([npc({ expressionImages: { sad: { ...image(), width: 2048 } } })])).toThrow();
    expect(() => validateNpcs([npc({ expressionImages: [] as unknown as Record<string, NpcImage> })])).toThrow();
    expect(() => validateNpcs([npc({ lines: ['[sad]  '] })])).toThrow();
    expect(() => validateNpcs([npc({ altLines: [{ flags: ['futaba_wings_done'], lines: ['[sad]'] }] })])).toThrow();
  });
});
