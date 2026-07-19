import { useEffect, useRef, useState } from 'react';

/** はじまりの祝福 (オンボード) の演出イベント。 */
export interface WelcomeEvent {
  /** 付与したあおぞらパワー。 */
  power: number;
}

type Listener = (ev: WelcomeEvent) => void;
const listeners = new Set<Listener>();

/** オンボード完了 (リセット直後) に「はじまりの祝福」を演出する。 */
export function notifyWelcome(ev: WelcomeEvent) {
  for (const cb of listeners) {
    try { cb(ev); } catch (e) { console.warn('welcome listener failed', e); }
  }
}

const WELCOME_DURATION_MS = 3200;

/**
 * オンボード完了時に「はじまりの祝福」を全面オーバーレイで演出する
 * (level-up-overlay と同じ作法。旅立ちの祝福 + 付与パワーを一度だけ流す)。
 */
export function WelcomeBlessingOverlay() {
  const [current, setCurrent] = useState<WelcomeEvent | null>(null);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const listener: Listener = (ev) => {
      setCurrent(ev);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCurrent(null), WELCOME_DURATION_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!current) return null;

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
        zIndex: 1100,
      }}
    >
      <style>{WELCOME_KEYFRAMES}</style>
      <div
        style={{
          padding: '1.2em 1.8em',
          background: 'rgba(10, 21, 40, 0.92)',
          border: '3px solid var(--color-accent)',
          borderRadius: 6,
          textAlign: 'center',
          animation: 'welcome-pop 420ms cubic-bezier(0.2, 0.9, 0.4, 1.4) both',
          boxShadow: '0 0 24px rgba(159, 215, 255, 0.5)',
        }}
      >
        <div
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: '1.5em',
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--color-accent)',
            textShadow: '0 0 12px rgba(159, 215, 255, 0.7)',
          }}
        >
          はじまりの祝福
        </div>
        <div style={{ marginTop: '0.6em', fontSize: '0.95em', color: '#ffffff', lineHeight: 1.7 }}>
          <div>やくそう と そらのはね を手にした</div>
          <div style={{ marginTop: '0.2em' }}>
            あおぞらパワー{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)', fontWeight: 700 }}>
              +{current.power}
            </span>
          </div>
        </div>
      </div>
      {/* 後光的な光る粒 (level-up-overlay と同系統) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          animation: 'welcome-burst 1.6s ease-out both',
          borderRadius: '50%',
          boxShadow:
            '0 0 0 6px rgba(255,255,255,0.55), 0 0 0 18px rgba(159,215,255,0.35), 0 0 0 42px rgba(159,215,255,0.15)',
          zIndex: -1,
        }}
      />
    </div>
  );
}

const WELCOME_KEYFRAMES = `
@keyframes welcome-pop { 0% { transform: scale(0.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes welcome-burst { 0% { opacity: 0.9; transform: scale(0.2); } 100% { opacity: 0; transform: scale(1.6); } }
`;
