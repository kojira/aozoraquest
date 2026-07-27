import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 仮想スティック (あおぞらワールドの移動操作)。
 *
 * マップのどこかをタッチ (またはマウスダウン) するとその場にスティックが現れ、
 * 押したまま指を動かすと倒した方向へ歩き続ける。離すと止まる。
 * 十字キーはスマホで非常に操作しづらい ための置き換え。
 *
 * - 4 方向 (支配軸 + ヒステリシス)。デッドゾーン未満は入力なし。
 * - 歩調: 方向確定で 1 歩 → そこから STEP_INTERVAL_MS 周期。方向転換で周期を
 *   張り直し、即時歩行にも最小間隔を課す (斜め付近のジッタで軸が反転するたびに
 *   歩く「連歩バースト」の防止。レビュー指摘)。
 * - 描画は「タッチ地点に基準リング + 指に追従するノブ」のフローティング式。
 * - 初回だけマップ下部にゴーストリングのガイドを出す (操作 UI が不可視なため)。
 * - 親は onMove を渡すだけ。戦闘中などの移動禁止は親の move() 側ガードに従う。
 */

export type StickDir = 'up' | 'down' | 'left' | 'right';

/** この距離 (px) 未満の倒しは入力にしない (タップの誤爆防止)。 */
const DEADZONE_PX = 14;
/** ノブが基準リングから離れられる最大距離 (px)。 */
const KNOB_RADIUS_PX = 44;
/** 連続歩行の間隔 (十字キー時代の HOLD_REPEAT_INTERVAL と同じ体感)。 */
const STEP_INTERVAL_MS = 170;
/** マップの外周この幅 (px) はスティックが反応しない素通しゾーン。
 *  端から始まるタッチはページスクロールに渡る (「スクロールしたいのに移動に
 *  なってしまう」= 実機で起きた)。
 *  注: touch-action は要素単位の宣言なので、イベントを無視するだけでは
 *  スクロールは復活しない — 反応領域そのものを inset で絞る必要がある。 */
const EDGE_PASS_PX = 36;
/** 即時歩行 (方向転換時) の最小間隔。ジッタ由来の軸反転バーストを抑える。 */
const MIN_STEP_GAP_MS = Math.floor(STEP_INTERVAL_MS / 2);
/** 軸を切り替えるのに必要な優位マージン (現在軸の 1.25 倍を要求)。
 *  斜め 45° 付近で up/right が毎フレーム反転するのを防ぐ。 */
const AXIS_HYSTERESIS = 1.25;
/** 初回ガイド (ゴーストリング) を出したかの localStorage キー。 */
const HINT_DONE_KEY = 'aq-world-stick-hint-done';
/** タップ判定: 押してから離すまで、この px 未満の移動 + この ms 未満で「タップ」。 */
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 400;
/** タップで「自分」を押したとみなす中央半径 (マップ短辺に対する割合)。
 *  アバターは中央にいるので、その周辺のタップをメニュー起動に割り当てる。 */
const TAP_CENTER_RATIO = 0.22;

/** 「自分をタップした」ジェスチャか (歩行せず・短時間・小移動・中央付近)。純関数。 */
export function isSelfTap(o: { elapsedMs: number; movedPx: number; fromCenterPx: number; minSide: number }): boolean {
  return (
    o.elapsedMs <= TAP_MAX_MS &&
    o.movedPx <= TAP_MAX_MOVE_PX &&
    o.fromCenterPx <= o.minSide * TAP_CENTER_RATIO
  );
}

/**
 * 倒しベクトル → 方向 (純関数。デッドゾーン + 支配軸 + ヒステリシス)。
 * current が立っている間は、直交軸が |現在軸| × AXIS_HYSTERESIS を超えるまで
 * 軸を切り替えない。テスト対象。
 */
export function stickDirFor(dx: number, dy: number, current: StickDir | null): StickDir | null {
  if (Math.hypot(dx, dy) < DEADZONE_PX) return null;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (current) {
    const curHorizontal = current === 'left' || current === 'right';
    if (curHorizontal && Math.abs(dy) < Math.abs(dx) * AXIS_HYSTERESIS) {
      return dx > 0 ? 'right' : 'left';
    }
    if (!curHorizontal && Math.abs(dx) < Math.abs(dy) * AXIS_HYSTERESIS) {
      return dy > 0 ? 'down' : 'up';
    }
  }
  return horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
}

export function VirtualStick({ onMove, onTapSelf }: { onMove: (dir: StickDir) => void; onTapSelf?: () => void }) {
  const [stick, setStick] = useState<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const [showHint, setShowHint] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(HINT_DONE_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const dirRef = useRef<StickDir | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStepAtRef = useRef(0);
  /** ドラッグ原点 (client 座標)。rect を毎 move 読むとレイアウト強制 + ドラッグ中の
   *  コンテナ移動でベクトルが歪む (レビュー指摘) ため、ベクトルは client 座標差分。 */
  const originRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const pointerIdRef = useRef<number | null>(null);
  const onTapSelfRef = useRef(onTapSelf);
  onTapSelfRef.current = onTapSelf;
  // タップ判定用: 押下時刻・押下 client 座標・マップ中央 (client) と短辺・移動フラグ
  const downRef = useRef<{ t: number; x: number; y: number; cx: number; cy: number; minSide: number } | null>(null);
  const movedRef = useRef(false);

  const step = useCallback((dir: StickDir) => {
    lastStepAtRef.current = Date.now();
    movedRef.current = true; // 1 歩でも歩いたらタップではない
    onMoveRef.current(dir);
  }, []);

  const restartInterval = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      if (dirRef.current) step(dirRef.current);
    }, STEP_INTERVAL_MS);
  }, [step]);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    dirRef.current = null;
    pointerIdRef.current = null;
    originRef.current = null;
    setStick(null);
  }, []);
  useEffect(() => stop, [stop]);

  /** ベクトルを方向に反映する (setState の updater 外で呼ぶこと — updater は純粋に保つ)。 */
  const applyVector = useCallback(
    (dx: number, dy: number) => {
      const dir = stickDirFor(dx, dy, dirRef.current);
      if (dir === dirRef.current) return;
      dirRef.current = dir;
      if (dir) {
        // 方向確定/転換: 最小間隔を守って 1 歩 + 周期を張り直す (2 連歩防止)
        if (Date.now() - lastStepAtRef.current >= MIN_STEP_GAP_MS) step(dir);
        restartInterval();
      }
    },
    [restartInterval, step],
  );

  const dismissHint = useCallback(() => {
    setShowHint(false);
    try { localStorage.setItem(HINT_DONE_KEY, '1'); } catch { /* private mode */ }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== null) return; // マルチタッチの 2 本目は無視
      if (e.pointerType === 'mouse' && e.button !== 0) return; // 右/中ドラッグでは歩かない
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerIdRef.current = e.pointerId;
      originRef.current = { clientX: e.clientX, clientY: e.clientY };
      const rect = e.currentTarget.getBoundingClientRect();
      setStick({ ox: e.clientX - rect.left, oy: e.clientY - rect.top, dx: 0, dy: 0 });
      dirRef.current = null;
      movedRef.current = false;
      downRef.current = {
        t: Date.now(),
        x: e.clientX,
        y: e.clientY,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        minSide: Math.min(rect.width, rect.height),
      };
      restartInterval();
      dismissHint();
    },
    [restartInterval, dismissHint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== pointerIdRef.current || !originRef.current) return;
      e.preventDefault();
      let dx = e.clientX - originRef.current.clientX;
      let dy = e.clientY - originRef.current.clientY;
      applyVector(dx, dy);
      const mag = Math.hypot(dx, dy);
      if (mag > KNOB_RADIUS_PX) {
        dx = (dx / mag) * KNOB_RADIUS_PX;
        dy = (dy / mag) * KNOB_RADIUS_PX;
      }
      setStick((s) => (s ? { ...s, dx, dy } : s));
    },
    [applyVector],
  );

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== pointerIdRef.current) return;
      // タップ判定: 歩いておらず・短時間・小移動で、押下点がマップ中央 (自分) 付近
      const d = downRef.current;
      if (d && !movedRef.current && onTapSelfRef.current) {
        const isTap = isSelfTap({
          elapsedMs: Date.now() - d.t,
          movedPx: Math.hypot(e.clientX - d.x, e.clientY - d.y),
          fromCenterPx: Math.hypot(d.x - d.cx, d.y - d.cy),
          minSide: d.minSide,
        });
        if (isTap) onTapSelfRef.current();
      }
      downRef.current = null;
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
      onLostPointerCapture={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        // 外周 EDGE_PASS_PX はスクロール用の素通しゾーン (touch-action none を
        // 全面に張るとマップから始まるスクロールが全部移動になる)
        inset: EDGE_PASS_PX,
        // スクロール/ピンチに食われず pointermove を受け続ける (この領域内のみ)
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      } as React.CSSProperties}
    >
      {/* AT フォールバック: 視覚非表示の 4 方向ボタン (十字キー撤去でモバイルの
          スクリーンリーダー利用者が移動手段を失わないように。レビュー指摘) */}
      <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {(['up', 'down', 'left', 'right'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onMoveRef.current(d)}
          >
            {d === 'up' ? '上に移動' : d === 'down' ? '下に移動' : d === 'left' ? '左に移動' : '右に移動'}
          </button>
        ))}
      </div>
      {/* 初回ガイド: 操作 UI が不可視なので、使い方をゴーストリングで 1 回だけ示す */}
      {showHint && !stick && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '72%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: KNOB_RADIUS_PX * 2,
              height: KNOB_RADIUS_PX * 2,
              margin: '0 auto',
              borderRadius: '50%',
              border: '2px solid rgba(0,0,0,0.5)',
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.7)',
              background: 'rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              animation: 'aq-stick-hint 1.6s ease-in-out infinite',
            }}
          >
            👆
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: '0.72em',
              color: '#fff',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
              whiteSpace: 'nowrap',
            }}
          >
            タッチしたまま指を動かすと移動
          </div>
          <style>{'@keyframes aq-stick-hint { 0%,100% { transform: scale(1); opacity: 0.85; } 50% { transform: scale(1.12); opacity: 1; } }'}</style>
        </div>
      )}
      {stick && (
        <>
          {/* 基準リング (白 + 黒の二重枠 — 明るい平原タイル上でも沈まない) */}
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
              border: '2px solid rgba(0,0,0,0.5)',
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.7)',
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
              background: 'rgba(255,255,255,0.85)',
              border: '2px solid rgba(0,0,0,0.45)',
              boxShadow: '0 1px 6px rgba(0,0,0,0.45)',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}
