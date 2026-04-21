import { useEffect, useRef, useState } from 'react';
import { LEVEL_UP_OVERLAY_DURATION_MS, LEVEL_UP_POP_DURATION_MS } from '@aozoraquest/core';

export interface LevelUpEvent {
  kind: 'job' | 'player';
  from: number;
  to: number;
  /** ジョブレベルアップ時はジョブ表示名、プレイヤーは undefined */
  jobName?: string;
}

type Listener = (ev: LevelUpEvent) => void;
const listeners = new Set<Listener>();

/** processSelfPost の結果を受け取って、レベルアップしていれば演出を発火する。 */
export function notifyLevelUp(ev: LevelUpEvent) {
  for (const cb of listeners) {
    try { cb(ev); } catch (e) { console.warn('level-up listener failed', e); }
  }
}

/**
 * アクション直後に「LV UP!」を全面オーバーレイで 2 秒ほど演出する。
 * 複数のイベント (ジョブ + プレイヤー同時 LV アップ) が来たら順番に流す。
 */
export function LevelUpOverlay() {
  const [current, setCurrent] = useState<LevelUpEvent | null>(null);
  const queueRef = useRef<LevelUpEvent[]>([]);
  const playingRef = useRef(false);

  useEffect(() => {
    const playNext = () => {
      const next = queueRef.current.shift();
      if (!next) {
        playingRef.current = false;
        setCurrent(null);
        return;
      }
      playingRef.current = true;
      setCurrent(next);
      window.setTimeout(playNext, LEVEL_UP_OVERLAY_DURATION_MS);
    };
    const listener: Listener = (ev) => {
      queueRef.current.push(ev);
      if (!playingRef.current) playNext();
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  if (!current) return null;

  const label = current.kind === 'job' ? `${current.jobName ?? ''} LEVEL UP!` : 'LEVEL UP!';

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 500,
      }}
    >
      <style>{LEVEL_UP_KEYFRAMES}</style>
      <div
        style={{
          padding: '1em 1.6em',
          background: 'rgba(10, 21, 40, 0.92)',
          border: '3px solid var(--color-accent)',
          borderRadius: 6,
          textAlign: 'center',
          animation: `lvup-pop ${LEVEL_UP_POP_DURATION_MS}ms cubic-bezier(0.2, 0.9, 0.4, 1.4) both, lvup-hold ${LEVEL_UP_OVERLAY_DURATION_MS}ms linear both`,
          boxShadow: '0 0 24px rgba(159, 215, 255, 0.5)',
        }}
      >
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '1.6em',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--color-accent)',
            textShadow: '0 0 12px rgba(159, 215, 255, 0.7)',
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: '0.4em',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '2.6em',
            fontWeight: 700,
            color: '#ffffff',
          }}
        >
          <span style={{ color: 'var(--color-muted)', fontSize: '0.6em' }}>LV</span>
          <span style={{ margin: '0 0.15em' }}>{current.from}</span>
          <span style={{ color: 'var(--color-muted)', fontSize: '0.7em', margin: '0 0.1em' }}>→</span>
          <span style={{ color: 'var(--color-accent)' }}>{current.to}</span>
        </div>
      </div>
      {/* 後光的な光る粒 */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          animation: 'lvup-burst 1.6s ease-out both',
          borderRadius: '50%',
          boxShadow:
            '0 0 0 6px rgba(255,255,255,0.55), 0 0 0 18px rgba(159,215,255,0.35), 0 0 0 42px rgba(159,215,255,0.15)',
          zIndex: -1,
        }}
      />
    </div>
  );
}

const LEVEL_UP_KEYFRAMES = `
@keyframes lvup-pop {
  0%   { opacity: 0; transform: scale(0.6) translateY(8px); }
  60%  { opacity: 1; transform: scale(1.08) translateY(0); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes lvup-hold {
  0%, 80%  { opacity: 1; }
  100%     { opacity: 0; }
}
@keyframes lvup-burst {
  0%   { width: 0; height: 0; opacity: 0.9; }
  100% { width: 360px; height: 360px; opacity: 0; }
}
`;
