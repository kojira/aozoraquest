import { describe, expect, test } from 'vitest';
import type { NpcImage } from '@aozoraquest/core';
import { npcDialogueLines } from './npc-image';

// D-DIALOGUE-005: tags never reach displayed text; only a registered tag overrides the window portrait.
const sad: NpcImage = { width: 512, height: 768, blob: { $type: 'blob', ref: { $link: `bafkre${'a'.repeat(53)}` }, mimeType: 'image/webp', size: 10 } };
const npc = { id: 'futaba-bluesky', name: 'Blueskyちゃん', expressionImages: { sad } };

describe('npcDialogueLines', () => {
  test('strips the tag and selects the registered expression portrait for that line only', () => {
    const lines = npcDialogueLines(npc, ['[sad]おにいちゃんが……', 'ふつう', '[smile]にこ', '[worried]うーん']);
    expect(lines.map((l) => l.text)).toEqual(['おにいちゃんが……', 'ふつう', 'にこ', 'うーん']);
    expect(lines.every((l) => l.speaker === 'Blueskyちゃん')).toBe(true);
    expect(lines[0]!.portrait?.src).toContain('expression=sad');
    expect(lines[0]!.portrait?.src).toContain(`cid=${sad.blob.ref.$link}`);
    // Untagged / unregistered tags fall back to the window's normal portraitImage (no per-line portrait).
    expect(lines.slice(1).map((l) => l.portrait)).toEqual([undefined, undefined, undefined]);
    expect(npcDialogueLines({ id: 'x', name: 'X' }, ['[sad]やあ'])).toEqual([{ speaker: 'X', text: 'やあ' }]);
  });
});
