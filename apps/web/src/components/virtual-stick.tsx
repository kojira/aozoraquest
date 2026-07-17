import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 仮想スティック (あおぞらワールドの移動操作)。
 *
 * マップのどこかをタッチ (またはマウスダウン) するとその場にスティックが現れ、
 * 押したまま指を動かすと倒した方向へ歩き続ける。離すと止まる。
 * 十字キーはスマホで非常に操作しづらい (オーナー報告 2026-07-17) ための置き換え。
 *
 * - 4 方向 (支配軸)。デッドゾーン未満は入力なし。
 * - 歩調は押下直後に 1 歩 + STEP_INTERVAL_MS ごとに 1 歩 (方向転換は即時 1 歩)。
 * - 描画は「タッチ地点に基準リング + 指に追従するノブ」のフローティング式
 *   (固定位置式より画面を専有しない。マップ全面がタッチ領域になる)。
 * - 親は onMove を渡すだけ。戦闘中などの移動禁止は親の move() 側ガードに従う。
 */

export type StickDir = 'up' | 'down' | 'left' | 'right';

/** この距離 (px) 未満の倒しは入力にしない (タップの誤爆防止)。 */
const DEADZONE_PX = 14;
/** ノブが基準リングから離れられる最大距離 (px)。 */
const KNOB_RADIUS_PX = 44;
/** 連続歩行の間隔 (十字キー時代の HOLD_REPEAT_INTERVAL と同じ体感)。 */
const STEP_INTERVAL_MS = 170;

export function VirtualStick({ onMove }: { onMove: (dir: StickDir) => void }) {
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const dirRef = useRef<StickDir | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const pointerIdRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    dirRef.current = null;
    pointerIdRef.current = null;
    setStick(null);
  }, []);
  useEffect(() => stop, [stop]);

  const applyVector = useCallback((dx: number, dy: number) => {
    const mag = Math.hypot(dx, dy);
    let dir: StickDir | null = null;
    if (mag >= DEADZONE_PX) {
      dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    if (dir !== dirRef.current) {
      dirRef.current = dir;
      if (dir) onMoveRef.current(dir); // 方向が決まった / 変わった瞬間に 1 歩 (レスポンス優先)
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== null) return; // マルチタッチの 2 本目は無視
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerIdRef.current = e.pointerId;
      const rect = e.currentTarget.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      setStick({ ox, oy, dx: 0, dy: 0 });
      dirRef.current = null;
      // 押している間、現在方向へ歩き続ける (方向転換の即時 1 歩は applyVector 側)
      timerRef.current = setInterval(() => {
        if (dirRef.current) onMoveRef.current(dirRef.current);
      }, STEP_INTERVAL_MS);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== pointerIdRef.current) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      setStick((s) => {
        if (!s) return s;
        let dx = e.clientX - rect.left - s.ox;
        let dy = e.clientY - rect.top - s.oy;
        const mag = Math.hypot(dx, dy);
        applyVector(dx, dy);
        if (mag > KNOB_RADIUS_PX) {
          dx = (dx / mag) * KNOB_RADIUS_PX;
          dy = (dy / mag) * KNOB_RADIUS_PX;
        }
        return { ...s, dx, dy };
      });
    },
    [applyVector],
  );

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== pointerIdRef.current) return;
      stop();
    },
    [stop],
  );

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        inset: 0,
        // スクロール/ピンチに食われず pointermove を受け続ける
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        cursor: 'crosshair',
      } as React.CSSProperties}
      aria-label="マップをタッチしたまま指を動かすと移動"
    >
      {stick && (
        <>
          {/* 基準リング */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: stick.ox,
              top: stick.oy,
              width: KNOB_RADIUS_PX * 2,
              height: KNOB_RADIUS_PX * 2,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.55)',
              background: 'rgba(0,0,0,0.18)',
              pointerEvents: 'none',
            }}
          />
          {/* ノブ (指に追従) */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: stick.ox + stick.dx,
              top: stick.oy + stick.dy,
              width: 40,
              height: 40,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.8)',
              boxShadow: '0 1px 6px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}
