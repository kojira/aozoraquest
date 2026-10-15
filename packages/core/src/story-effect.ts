/**
 * **会話の演出** (D-STORY-007)。会話窓の行に付けて、地図枠に暗転・逆光シルエット・
 * 閃光・色かぶりを出す。web の冒頭とシナリオのお知らせが同じ型を使う。
 *
 * 色・種類は閉じた列挙 (任意色/任意画像は受け付けない)。シルエットは同梱の 1 枚だけ。
 */
export type StoryEffect =
  | { kind: 'fade'; to: 'black' | 'clear' }
  | { kind: 'silhouette'; show: boolean }
  | { kind: 'flash'; color: 'white' | 'red' }
  | { kind: 'tint'; color: 'red' };

export const MAX_STORY_EFFECTS = 4;

export function isStoryEffect(v: unknown): v is StoryEffect {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  const keys = Object.keys(e).length;
  switch (e.kind) {
    case 'fade': return keys === 2 && (e.to === 'black' || e.to === 'clear');
    case 'silhouette': return keys === 2 && typeof e.show === 'boolean';
    case 'flash': return keys === 2 && (e.color === 'white' || e.color === 'red');
    case 'tint': return keys === 2 && e.color === 'red';
    default: return false;
  }
}

/** 演出の並びとして正しいか (配列・上限件数・各要素が列挙どおり)。 */
export function isStoryEffectList(v: unknown): v is StoryEffect[] {
  return Array.isArray(v) && v.length <= MAX_STORY_EFFECTS && v.every(isStoryEffect);
}
