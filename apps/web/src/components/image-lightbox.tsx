import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { PostImage } from '@/lib/post-embed';

/**
 * 投稿画像のフルスクリーンビューア。
 *
 * - ESC / 背景クリック / 閉じるボタンで閉じる
 * - 複数枚: ← → キー、左右ボタン、**横スワイプ (指追従カルーセル)** で前後移動
 * - **ピンチイン/アウトでズーム**、ズーム中は 1 本指ドラッグでパン、ダブルタップ /
 *   ダブルクリックでズーム↔等倍トグル。ズーム中は横スワイプはページ送りにせずパンにする。
 * - 端まで来たら止まる (ループしない。端ではドラッグに抵抗をかける)
 * - 次/前の画像を new Image().src でプリロード
 * - body のスクロールを掴んだままにしない
 *
 * スワイプは横カルーセル方式: 全スライドを横一列に並べ translateX で動かす。
 * `touch-action: none` でブラウザの縦スクロール/パン/ピンチにジェスチャを奪われないようにし、
 * touchmove で指に追従、touchend で閾値を超えたら次/前へスナップ (transition でスライドイン)。
 */
const SWIPE_THRESHOLD_RATIO = 0.18; // ビューポート幅のこの割合を超えたらページ送り
const SWIPE_THRESHOLD_MAX = 60;     // ただし最低でもこの px を超えれば送る
const MAX_SCALE = 5;                // ピンチ/ダブルタップの最大倍率
const DOUBLE_TAP_SCALE = 3;         // ダブルタップ時に飛ぶ倍率 (スクショの小文字も読める程度)
const DOUBLE_TAP_MS = 300;          // ダブルタップ判定の間隔
const TAP_MOVE_TOL = 10;            // これ未満の移動はタップ扱い (ダブルタップ検出)

interface Zoom {
  scale: number;
  tx: number;
  ty: number;
}
const IDENTITY: Zoom = { scale: 1, tx: 0, ty: 0 };

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
}: {
  images: PostImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(initialIndex);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 現在画像のズーム状態。ref を即時ソースにし state は描画反映用 (gesture 中の stale 読み回避)。
  const [zoom, setZoom] = useState<Zoom>(IDENTITY);
  const zoomRef = useRef<Zoom>(IDENTITY);
  const [gesturing, setGesturing] = useState(false);
  const applyZoom = useCallback((z: Zoom) => {
    zoomRef.current = z;
    setZoom(z);
  }, []);

  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<'h' | 'v' | null>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const vpW = useRef(0);
  // ピンチ (2 本指) / パン (ズーム中 1 本指) のジェスチャ追跡。
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);
  // 単指タッチの開始点 (タップ判定用)。ピンチからの引き継ぎパンでは付けない (= タップ扱いしない)。
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => {
        const n = i + delta;
        if (n < 0 || n >= images.length) return i;
        return n;
      });
    },
    [images.length],
  );

  // 画像を切り替えたらズームを等倍にリセット (前の画像の拡大状態を持ち越さない)。
  useEffect(() => {
    applyZoom(IDENTITY);
  }, [idx, applyZoom]);

  // keyboard + body scroll lock
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, go]);

  // 前後の画像をプリロード
  useEffect(() => {
    for (const j of [idx + 1, idx - 1]) {
      const im = images[j];
      if (im) { const pre = new Image(); pre.src = im.fullsize; }
    }
  }, [idx, images]);

  const multi = images.length > 1;
  const hasPrev = idx > 0;
  const hasNext = idx < images.length - 1;

  // ビューポート中心と実寸 (ピンチのアンカー計算・パン境界に使う)。
  const viewport = useCallback(() => {
    const el = vpRef.current;
    if (!el) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      return { cx: w / 2, cy: h / 2, w, h };
    }
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };
  }, []);

  // translate を「画像がビューポートから出過ぎない」範囲に丸める。
  const clampZoom = useCallback((z: Zoom, w: number, h: number): Zoom => {
    const maxX = Math.max(0, ((z.scale - 1) * w) / 2);
    const maxY = Math.max(0, ((z.scale - 1) * h) / 2);
    return {
      scale: z.scale,
      tx: Math.max(-maxX, Math.min(maxX, z.tx)),
      ty: Math.max(-maxY, Math.min(maxY, z.ty)),
    };
  }, []);

  // 指が外れた / ジェスチャ中断時に drag が途中値で固定されないよう確実にリセットする。
  function resetDrag() {
    setDragging(false);
    setDrag(0);
    axis.current = null;
    pinch.current = null;
    pan.current = null;
    panStart.current = null;
    setGesturing(false);
  }

  const zoomTo = useCallback(
    (targetScale: number, screenX: number, screenY: number) => {
      const { cx, cy, w, h } = viewport();
      if (targetScale <= 1.001) {
        applyZoom(IDENTITY);
        return;
      }
      // 等倍 (tx=ty=0) からアンカー点を固定して targetScale へ。
      const mrx = screenX - cx;
      const mry = screenY - cy;
      const next = clampZoom({ scale: targetScale, tx: mrx * (1 - targetScale), ty: mry * (1 - targetScale) }, w, h);
      applyZoom(next);
    },
    [viewport, clampZoom, applyZoom],
  );

  function twoTouchDist(a: React.Touch, b: React.Touch): number {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  // タップ (= ダブルタップ) 判定。ズーム中/等倍どちらの経路からも呼べる。
  function handleTapAt(x: number, y: number) {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      zoomTo(zoomRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE, x, y);
    } else {
      lastTap.current = now;
    }
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length >= 2) {
      // ピンチ開始。カルーセルドラッグはキャンセル。
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      pinch.current = { dist: twoTouchDist(a, b), midX: (a.clientX + b.clientX) / 2, midY: (a.clientY + b.clientY) / 2 };
      pan.current = null;
      setDragging(false);
      setDrag(0);
      axis.current = null;
      setGesturing(true);
      return;
    }
    const t = e.touches[0];
    if (!t) return;
    if (zoomRef.current.scale > 1) {
      // ズーム中の 1 本指 = パン。開始点を控えて (ほぼ動かなければ) ダブルタップも拾えるように。
      pan.current = { x: t.clientX, y: t.clientY };
      panStart.current = { x: t.clientX, y: t.clientY };
      setGesturing(true);
      return;
    }
    // 等倍 = 従来のカルーセルスワイプ。
    startX.current = t.clientX;
    startY.current = t.clientY;
    axis.current = null;
    vpW.current = vpRef.current?.clientWidth ?? window.innerWidth;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    // ── ピンチ ──
    if (pinch.current && e.touches.length >= 2) {
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const nd = twoTouchDist(a, b);
      const nmx = (a.clientX + b.clientX) / 2;
      const nmy = (a.clientY + b.clientY) / 2;
      const { cx, cy } = viewport();
      const prev = zoomRef.current;
      const scale = Math.max(1, Math.min(MAX_SCALE, (prev.scale * nd) / (pinch.current.dist || nd)));
      const ratio = scale / prev.scale;
      // 2 本指の移動ぶんパン → 現在の中点を固定してズーム。
      let tx = prev.tx + (nmx - pinch.current.midX);
      let ty = prev.ty + (nmy - pinch.current.midY);
      const mrx = nmx - cx;
      const mry = nmy - cy;
      tx = mrx - ratio * (mrx - tx);
      ty = mry - ratio * (mry - ty);
      applyZoom({ scale, tx, ty });
      pinch.current = { dist: nd, midX: nmx, midY: nmy };
      return;
    }
    // ── パン (ズーム中) ──
    if (pan.current && e.touches.length === 1) {
      const t = e.touches[0]!;
      const prev = zoomRef.current;
      const { w, h } = viewport();
      const next = clampZoom(
        { scale: prev.scale, tx: prev.tx + (t.clientX - pan.current.x), ty: prev.ty + (t.clientY - pan.current.y) },
        w,
        h,
      );
      applyZoom(next);
      pan.current = { x: t.clientX, y: t.clientY };
      return;
    }
    // ── カルーセル (等倍) ──
    if (e.touches.length > 1) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (axis.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      axis.current = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
    }
    if (axis.current === 'h') {
      const atEdge = (idx === 0 && dx > 0) || (idx === images.length - 1 && dx < 0);
      setDrag(atEdge ? dx / 3 : dx);
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    // ── ピンチ/パンの終了 ──
    if (pinch.current || pan.current) {
      if (e.touches.length === 0) {
        setGesturing(false);
        const wasTapCandidate = panStart.current;
        pinch.current = null;
        pan.current = null;
        panStart.current = null;
        // ズーム中に (ほぼ動かさず) タップした = ダブルタップでズームアウトできるように拾う。
        if (wasTapCandidate) {
          const ex = e.changedTouches[0]?.clientX ?? wasTapCandidate.x;
          const ey = e.changedTouches[0]?.clientY ?? wasTapCandidate.y;
          if (Math.abs(ex - wasTapCandidate.x) < TAP_MOVE_TOL && Math.abs(ey - wasTapCandidate.y) < TAP_MOVE_TOL) {
            handleTapAt(ex, ey);
            return;
          }
        }
        const z = zoomRef.current;
        if (z.scale <= 1.02) applyZoom(IDENTITY);
        else {
          const { w, h } = viewport();
          applyZoom(clampZoom(z, w, h));
        }
      } else if (e.touches.length === 1) {
        // 2 本指の片方が離れた → 残り 1 本指でパンに引き継ぐ (急に飛ばないよう基準点を取り直す)。
        // 引き継ぎパンはタップ候補にしない (panStart は付けない)。
        pinch.current = null;
        const t = e.touches[0];
        if (t && zoomRef.current.scale > 1.02) {
          pan.current = { x: t.clientX, y: t.clientY };
        } else {
          pan.current = null;
          setGesturing(false);
        }
      }
      return;
    }
    // ── カルーセルの終了 (タップ判定 = ダブルタップも拾う) ──
    setDragging(false);
    const a = axis.current;
    axis.current = null;
    const endX = e.changedTouches[0]?.clientX ?? startX.current;
    const endY = e.changedTouches[0]?.clientY ?? startY.current;
    const dx = endX - startX.current;
    const dy = endY - startY.current;
    // 軸が立たない微小移動 = タップ (ダブルタップならズームトグル)。
    if (a === null && Math.abs(dx) < TAP_MOVE_TOL && Math.abs(dy) < TAP_MOVE_TOL) {
      handleTapAt(endX, endY);
      setDrag(0);
      return;
    }
    // 横スワイプ判定: axis が 'h' で確定、または高速フリックで axis 未確定でも終端デルタが
    // 横優勢なら横送り扱いにする (サンプルが少ない速い指で送りが死ぬのを防ぐ)。
    const horizontal = a === 'h' || (a === null && Math.abs(dx) > Math.abs(dy));
    if (!horizontal) {
      setDrag(0);
      return;
    }
    const threshold = Math.min(SWIPE_THRESHOLD_MAX, vpW.current * SWIPE_THRESHOLD_RATIO);
    if (Math.abs(dx) > threshold) go(dx < 0 ? 1 : -1);
    setDrag(0);
  }

  // デスクトップ: ホイールでカーソル位置を固定してズーム。
  function onWheel(e: React.WheelEvent) {
    e.stopPropagation();
    const { cx, cy, w, h } = viewport();
    const prev = zoomRef.current;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const scale = Math.max(1, Math.min(MAX_SCALE, prev.scale * factor));
    if (scale <= 1.001) {
      applyZoom(IDENTITY);
      return;
    }
    const ratio = scale / prev.scale;
    const mrx = e.clientX - cx;
    const mry = e.clientY - cy;
    applyZoom(clampZoom({ scale, tx: mrx - ratio * (mrx - prev.tx), ty: mry - ratio * (mry - prev.ty) }, w, h));
  }

  // デスクトップ: ダブルクリックでズームトグル。
  function onDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    zoomTo(zoomRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE, e.clientX, e.clientY);
  }

  if (!images[idx]) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.92)',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2vh 2vw',
      }}
    >
      {/* 画像エリア = 横カルーセル。touch-action:none でブラウザの縦スクロール/パン/ピンチに
          ジェスチャを奪われないようにする (= 指追従が安定)。 */}
      <div
        ref={vpRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={resetDrag}
        onWheel={onWheel}
        // 画像エリア (レターボックス余白含む) のタップで誤って閉じない。閉じるのは
        // 背景余白 / ✕ ボタン / ESC のみ (スワイプ後のタップ誤爆も防ぐ)。
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          overflow: 'hidden',
          touchAction: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            height: '100%',
            transform: `translateX(calc(${-idx * 100}% + ${drag}px))`,
            transition: dragging ? 'none' : 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {images.map((im, i) => {
            const isCurrent = i === idx;
            return (
              <div
                key={i}
                style={{ flex: '0 0 100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={im.fullsize}
                  alt={im.alt}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={onDoubleClick}
                  draggable={false}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    userSelect: 'none',
                    // ズーム変形は現在表示中の画像だけに適用。
                    transform: isCurrent ? `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})` : undefined,
                    transformOrigin: 'center center',
                    transition: isCurrent && !gesturing ? 'transform 0.2s ease' : 'none',
                    cursor: isCurrent && zoom.scale > 1 ? (gesturing ? 'grabbing' : 'grab') : 'zoom-in',
                    touchAction: 'none',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* 下部コントロール: 親指で届く位置に。前後 ‹›・カウンタは画像の下、
          閉じる × は最下部 (画面上部まで指を伸ばさなくて済むように)。 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: '0 0 auto',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 0px))',
          color: 'rgba(255,255,255,0.9)',
          fontSize: 13,
        }}
      >
        {images[idx]!.alt && (
          <span style={{ maxWidth: 720, textAlign: 'center', lineHeight: 1.5, padding: '0 16px' }}>{images[idx]!.alt}</span>
        )}

        {multi && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button
              type="button"
              disabled={!hasPrev}
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label="前の画像"
              style={navBtnStyle(hasPrev)}
            >
              <ChevronIcon dir="left" />
            </button>
            <span style={{ fontFamily: 'ui-monospace, monospace', minWidth: '3.5em', textAlign: 'center' }}>
              {idx + 1} / {images.length}
            </span>
            <button
              type="button"
              disabled={!hasNext}
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label="次の画像"
              style={navBtnStyle(hasNext)}
            >
              <ChevronIcon dir="right" />
            </button>
          </div>
        )}

        {/* 閉じる (最下部・中央) */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="閉じる"
          style={navBtnStyle(true)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** 前/次の丸ボタンのスタイル (有効/無効で色を出し分け)。 */
function navBtnStyle(enabled: boolean): CSSProperties {
  return {
    width: 44,
    height: 44,
    borderRadius: 22,
    border: 'none',
    background: enabled ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)',
    color: enabled ? '#fff' : 'rgba(255,255,255,0.35)',
    cursor: enabled ? 'pointer' : 'default',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  };
}

/** 閉じる × アイコン (グリフだと字形で中央がずれるので SVG で正確に中央化)。 */
function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** 前/次の山形アイコン (グリフ ‹ › は字形が左右非対称で中央がずれるため SVG)。 */
function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  const d = dir === 'left' ? 'M15 5 8 12 15 19' : 'M9 5 16 12 9 19';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d={d} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
