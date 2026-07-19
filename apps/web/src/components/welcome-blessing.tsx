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

/** 演出の見せ時間 (フェード開始まで) と フェードの尺。合計 ≈ 3.3s。
 *  呼び出し側の reload はこの合計より後 (余韻込み) にずらすこと (パッと消えて即リロードだと締まらない)。 */
export const WELCOME_VISIBLE_MS = 2800;
export const WELCOME_FADE_MS = 500;
export const WELCOME_TOTAL_MS = WELCOME_VISIBLE_MS + WELCOME_FADE_MS;

/**
 * オンボード完了時に「はじまりの祝福」を全面オーバーレイで演出する
 * (level-up-overlay と同じ作法。旅立ちの祝福 + 付与パワーを一度だけ流す)。
 * **単一マウント前提** (world ルートに 1 つ)。複数マウントすると notifyWelcome が全 listener に
 * 配られ二重演出になる (cleanup はしているので実害は薄いが 1 箇所に留めること)。
 */
export function WelcomeBlessingOverlay() {
  const [current, setCurrent] = useState<WelcomeEvent | null>(null);
  const [leaving, setLeaving] = useState(false); // フェードアウト中 (opacity→0)
  const fadeRef = useRef<number | null>(null);
  const endRef = useRef<number | null>(null);
  useEffect(() => {
    const listener: Listener = (ev) => {
      if (fadeRef.current) window.clearTimeout(fadeRef.current);
      if (endRef.current) window.clearTimeout(endRef.current);
      setCurrent(ev);
      setLeaving(false);
      // 見せ切ってからフェード → 消灯 (パッと消えず、余韻を残す)
      fadeRef.current = window.setTimeout(() => setLeaving(true), WELCOME_VISIBLE_MS);
      endRef.current = window.setTimeout(() => setCurrent(null), WELCOME_TOTAL_MS);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (fadeRef.current) window.clearTimeout(fadeRef.current);
      if (endRef.current) window.clearTimeout(endRef.current);
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
        opacity: leaving ? 0 : 1,
        transition: `opacity ${WELCOME_FADE_MS}ms ease`,
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
