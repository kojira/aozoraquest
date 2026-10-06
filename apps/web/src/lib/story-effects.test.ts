import { describe, expect, it } from 'vitest';
import { storyEffectState, transientStoryEffects } from './story-effects';
import type { DialogueLine } from './dialogue';

const LINES: DialogueLine[] = [
  { text: '……ここは、どこ？', effects: [{ kind: 'fade', to: 'black' }] },
  { text: 'シルエット', effects: [{ kind: 'silhouette', show: true }] },
  { speaker: '？？？', text: 'やっと とどいた。' },
  { speaker: 'Blueskyちゃん', text: '……きこえる？', effects: [{ kind: 'fade', to: 'clear' }, { kind: 'silhouette', show: false }, { kind: 'flash', color: 'white' }] },
];

describe('storyEffectState', () => {
  it('index 2 では 行0..2 の暗転とシルエットが続いている', () => {
    expect(storyEffectState(LINES, 2)).toEqual({ black: true, silhouette: true });
  });
  it('救護の行で暗転とシルエットが解ける', () => {
    expect(storyEffectState(LINES, 3)).toEqual({ black: false, silhouette: false });
  });
  it('演出の無い会話は何も出さない', () => {
    expect(storyEffectState([{ text: 'a' }], 0)).toEqual({ black: false, silhouette: false });
  });
});

describe('transientStoryEffects', () => {
  it('flash/tint だけを返し、reduced-motion では空', () => {
    expect(transientStoryEffects(LINES[3], false)).toEqual([{ kind: 'flash', color: 'white' }]);
    expect(transientStoryEffects(LINES[3], true)).toEqual([]);
  });
});
