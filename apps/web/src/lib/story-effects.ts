import type { StoryEffect } from '@aozoraquest/core';
import type { DialogueLine } from '@/lib/dialogue';

/** 会話窓の持続演出 (暗転・シルエット)。窓が閉じれば消える = 会話の外へ漏れない。 */
export interface StoryEffectState {
  black: boolean;
  silhouette: boolean;
}

/** 行 0..index の fade / silhouette を畳み込んだ持続状態 (D-STORY-007)。 */
export function storyEffectState(lines: readonly DialogueLine[], index: number): StoryEffectState {
  const st: StoryEffectState = { black: false, silhouette: false };
  for (let i = 0; i <= index && i < lines.length; i++) {
    for (const e of lines[i]!.effects ?? []) {
      if (e.kind === 'fade') st.black = e.to === 'black';
      else if (e.kind === 'silhouette') st.silhouette = e.show;
    }
  }
  return st;
}

/** その行で一度だけ再生する一過性の演出 (flash / tint)。reduced-motion では再生しない。 */
export function transientStoryEffects(line: DialogueLine | undefined, reduced: boolean): Extract<StoryEffect, { kind: 'flash' | 'tint' }>[] {
  if (reduced || !line?.effects) return [];
  return line.effects.filter((e): e is Extract<StoryEffect, { kind: 'flash' | 'tint' }> => e.kind === 'flash' || e.kind === 'tint');
}
