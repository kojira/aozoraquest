import { describe, expect, it } from 'vitest';
import { parseNpcLine, validateNpcs, type NpcDef } from '../npc-data.js';

// E2: leading `[fx:name]` tags on NPC lines map 1:1 to StoryEffect; typos are rejected on save.
const npc = (patch: Partial<NpcDef> = {}): NpcDef => ({ id: 'n', name: 'NPC', x: 0, y: 0, lines: ['hello'], ...patch });

describe('parseNpcLine effect tags', () => {
  it('maps every effect tag to the StoryEffect and strips it from the text', () => {
    expect(parseNpcLine('[fx:fade-black]さようなら')).toEqual({ effects: [{ kind: 'fade', to: 'black' }], text: 'さようなら' });
    expect(parseNpcLine('[fx:fade-clear][fx:silhouette-on][fx:silhouette-off][fx:flash-white][fx:flash-red][fx:tint-red]x').effects).toEqual([
      { kind: 'fade', to: 'clear' }, { kind: 'silhouette', show: true }, { kind: 'silhouette', show: false },
      { kind: 'flash', color: 'white' }, { kind: 'flash', color: 'red' }, { kind: 'tint', color: 'red' },
    ]);
  });
  it('combines with one expression tag in either order', () => {
    expect(parseNpcLine('[sad][fx:silhouette-on]…')).toEqual({ expression: 'sad', effects: [{ kind: 'silhouette', show: true }], text: '…' });
    expect(parseNpcLine('[fx:silhouette-on][sad]…')).toEqual({ expression: 'sad', effects: [{ kind: 'silhouette', show: true }], text: '…' });
    expect(parseNpcLine('[smile][sad]やあ')).toEqual({ expression: 'smile', text: '[sad]やあ' });
  });
});

describe('validateNpcs effect tags', () => {
  it('accepts known tags in lines and altLines', () => {
    expect(() => validateNpcs([npc({ lines: ['[fx:fade-black]……'], altLines: [{ flags: ['a_b'], lines: ['[fx:silhouette-on]だれ？'] }] })])).not.toThrow();
  });
  it('rejects unknown, misplaced, too many and tag-only effect lines', () => {
    expect(() => validateNpcs([npc({ lines: ['[fx:fade-blak]……'] })])).toThrow(/演出タグ/);
    expect(() => validateNpcs([npc({ altLines: [{ flags: ['a_b'], lines: ['[fx:Fade-black]……'] }] })])).toThrow(/演出タグ/);
    expect(() => validateNpcs([npc({ lines: ['……[fx:fade-black]'] })])).toThrow(/演出タグ/);
    expect(() => validateNpcs([npc({ lines: [`${'[fx:flash-white]'.repeat(5)}x`] })])).toThrow(/演出タグ/);
    expect(() => validateNpcs([npc({ lines: ['[fx:fade-black]'] })])).toThrow();
  });
});
