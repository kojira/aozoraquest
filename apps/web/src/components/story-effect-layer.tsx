import brotherSilhouette from '@/assets/story/brother-silhouette.webp';
import type { StoryEffect } from '@aozoraquest/core';

type TransientEffect = Extract<StoryEffect, { kind: 'flash' | 'tint' }>;
import type { StoryEffectState } from '@/lib/story-effects';

/** 送り面 (900) と窓 (901) の間。DOM 上は送り面の後に置くので同じ z でも上に重なる。 */
const STORY_EFFECT_Z = 900;
const FILL: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

/**
 * 会話窓の演出を地図枠 (anchor="map" の position:relative 祖先) に描く (D-STORY-007)。
 * 持続 (暗転・シルエット) は state、一過性 (flash/tint) は transient を playKey ごとに一度だけ再生。
 * reduced-motion では持続を即時切替にし、一過性は呼出側が渡さない。
 */
export function StoryEffectLayer({ state, transient, playKey, reduced }: {
  state: StoryEffectState;
  transient: readonly TransientEffect[];
  playKey: string;
  reduced: boolean;
}) {
  const fade = (ms: number) => (reduced ? 'none' : `opacity ${ms}ms ease`);
  return (
    <div data-testid="story-effect-layer" aria-hidden style={{ ...FILL, zIndex: STORY_EFFECT_Z, overflow: 'hidden' }}>
      <div data-testid="story-black" style={{ ...FILL, background: '#05070d', opacity: state.black ? 1 : 0, transition: fade(600) }} />
      {/* 会話イラストと同じ範囲 (窓より上) に逆光シルエット。顔・色は持たない単色 webp。 */}
      <div data-testid="story-silhouette" style={{ position: 'absolute', top: '0.5em', bottom: 'calc(35% + 2.5em)', left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: state.silhouette ? 1 : 0, transition: fade(800) }}>
        <div style={{ ...FILL, background: 'radial-gradient(ellipse 45% 50% at 50% 55%, rgba(170,195,255,.55), rgba(90,115,180,.22) 45%, transparent 75%)' }} />
        {state.silhouette && (
          <img src={brotherSilhouette} alt="" style={{ position: 'relative', maxWidth: '92%', maxHeight: '100%', objectFit: 'contain',
            filter: 'drop-shadow(0 0 2px #dfe8ff) drop-shadow(0 0 14px rgba(160,190,255,.7))' }} />
        )}
      </div>
      {transient.map((e, i) => (
        <div key={`${playKey}-${i}`} data-testid={`story-${e.kind}-${e.color}`} className={`aq-story-${e.kind}`}
          style={{ ...FILL, background: e.color === 'white' ? '#fff' : e.kind === 'flash' ? '#ff3b30' : 'rgba(220,30,20,.45)', opacity: 0 }} />
      ))}
      <style>{`
@keyframes aq-story-flash { 0% { opacity: 0; } 15% { opacity: 1; } 45% { opacity: 1; } 100% { opacity: 0; } }
@keyframes aq-story-tint { 0% { opacity: 0; } 20% { opacity: 1; } 100% { opacity: 0; } }
.aq-story-flash { animation: aq-story-flash 700ms ease-out both; }
.aq-story-tint { animation: aq-story-tint 1600ms ease-out both; }
@media (prefers-reduced-motion: reduce) { .aq-story-flash, .aq-story-tint { display: none; } }
`}</style>
    </div>
  );
}
