import { MAX_STORY_EFFECTS, type StoryEffect } from '@aozoraquest/core';

/** 管理画面で選べる演出 (D-STORY-007)。閉じた列挙のプリセットだけ。 */
export const STORY_EFFECT_PRESETS: readonly { label: string; effect: StoryEffect }[] = [
  { label: '暗転する', effect: { kind: 'fade', to: 'black' } },
  { label: '暗転を戻す', effect: { kind: 'fade', to: 'clear' } },
  { label: 'シルエットを出す', effect: { kind: 'silhouette', show: true } },
  { label: 'シルエットを消す', effect: { kind: 'silhouette', show: false } },
  { label: '白い閃光', effect: { kind: 'flash', color: 'white' } },
  { label: '赤い閃光', effect: { kind: 'flash', color: 'red' } },
  { label: '空が赤く染まる', effect: { kind: 'tint', color: 'red' } },
];

const presetIndex = (e: StoryEffect) => STORY_EFFECT_PRESETS.findIndex((p) => JSON.stringify(p.effect) === JSON.stringify(e));

/** お知らせ行の演出の並び。お知らせが空なら編集できない (描画先が無い)。 */
export function ScenarioEffectsField({ effects, disabled, onChange }: {
  effects: readonly StoryEffect[];
  disabled: boolean;
  onChange: (next: StoryEffect[]) => void;
}) {
  return (
    <div style={{ fontSize: '0.8em' }}>
      <span style={{ color: 'var(--color-muted)' }}>演出 (お知らせを出す瞬間に地図へ)</span>
      {effects.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3em', margin: '0.15em 0' }}>
          <select aria-label={`演出 ${i + 1}`} value={presetIndex(e)} disabled={disabled}
            onChange={(ev) => onChange(effects.map((x, j) => (j === i ? STORY_EFFECT_PRESETS[Number(ev.target.value)]!.effect : x)))}>
            {STORY_EFFECT_PRESETS.map((p, k) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          <button type="button" aria-label={`演出 ${i + 1} を消す`} onClick={() => onChange(effects.filter((_, j) => j !== i))} style={{ fontSize: '0.8em' }}>×</button>
        </div>
      ))}
      <button type="button" disabled={disabled || effects.length >= MAX_STORY_EFFECTS}
        onClick={() => onChange([...effects, STORY_EFFECT_PRESETS[6]!.effect])} style={{ fontSize: '0.8em' }}>
        ＋演出
      </button>
      {disabled && <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>お知らせを書くと使える</span>}
    </div>
  );
}
