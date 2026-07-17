import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * エンカウント演出 (DQ1 オマージュ): 黒い四角が回転しながら画面を埋め、
 * 覆い切った瞬間に下のコンテンツをバトル画面へ差し替えて、逆再生で開く。
 *
 * 使い方 (world.tsx / trial-arena.tsx):
 *   phase: 'cover'  — マップの上でタイルが閉じていく
 *   phase: 'hold'   — 全面黒のまま待機 (支払い通信が cover より長いときのつなぎ)
 *   phase: 'reveal' — バトル画面の上でタイルが開いていく
 *   onCoverDone     — 覆い切ったら 1 回呼ばれる (ここで下をバトル画面に差し替える)
 *   onRevealDone    — 開き切ったら 1 回呼ばれる (ここでオーバーレイを外す)
 *
 * prefers-reduced-motion では CSS 側で実質ゼロ時間になり、パッと切り替わる
 * (酔い・点滅対策。挙動フローは同じなのでロジック分岐は不要)。
 */

export type WipePhase = 'cover' | 'hold' | 'reveal';

/** タイル 1 辺の目安 px (画面幅から列数を決める)。 */
const TILE_PX = 56;
/** 中心から 1 タイル遠ざかるごとの開始遅延 (ms)。 */
const DELAY_PER_DIST = 45;
/** 1 タイルのアニメ時間 (styles.css の 0.4s と合わせる)。 */
const TILE_ANIM_MS = 400;

export function EncounterWipe({
  phase,
  onCoverDone,
  onRevealDone,
}: {
  phase: WipePhase;
  onCoverDone?: () => void;
  onRevealDone?: () => void;
}) {
  // グリッドはマウント時の viewport から決める (回転などでの再計算はしない —
  // 演出は 1 秒強で終わるので過剰対応しない)
  const grid = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 375;
    const h = typeof window !== 'undefined' ? window.innerHeight : 667;
    const cols = Math.max(4, Math.ceil(w / TILE_PX));
    const rows = Math.max(4, Math.ceil(h / TILE_PX));
    return { cols, rows };
  }, []);

  // 完了通知: 最大 delay + アニメ時間の timeout で 1 回だけ発火する。
  // (onAnimationEnd はタイル数ぶん飛んでくるので使わない)
  const coverDoneRef = useRef(onCoverDone);
  coverDoneRef.current = onCoverDone;
  const revealDoneRef = useRef(onRevealDone);
  revealDoneRef.current = onRevealDone;
  // reduced-motion では delay/duration がほぼ 0 なので、完了通知も即時に近づける
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (phase === 'hold') return;
    const { cols, rows } = grid;
    const maxDist = Math.hypot(cols / 2, rows / 2);
    const total = reduced ? 30 : maxDist * DELAY_PER_DIST + TILE_ANIM_MS + 60;
    const t = setTimeout(() => {
      if (phase === 'cover') coverDoneRef.current?.();
      else revealDoneRef.current?.();
    }, total);
    return () => clearTimeout(t);
  }, [phase, grid, reduced]);

  const { cols, rows } = grid;
  const tiles = [];
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dist = Math.hypot(c - cx, r - cy);
      tiles.push(
        <div
          key={`${c}-${r}`}
          className="enc-tile"
          style={{
            left: `${(c / cols) * 100}%`,
            top: `${(r / rows) * 100}%`,
            width: `${100 / cols}%`,
            height: `${100 / rows}%`,
            ['--d' as string]: `${Math.round(dist * DELAY_PER_DIST)}ms`,
          }}
        />,
      );
    }
  }

  return (
    <div
      className={`enc-${phase}`}
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000, // footer-nav より上 (戦闘導入中の誤タップも物理的に防ぐ)
        pointerEvents: 'auto', // 演出中の下要素タップを吸う
        overflow: 'hidden',
      }}
    >
      {tiles}
    </div>
  );
}
