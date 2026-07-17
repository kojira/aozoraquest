import { useEffect, useMemo, useRef } from 'react';

/**
 * エンカウント演出 (DQ1 オマージュ): 黒い四角が中心から渦を巻くように画面を埋め、
 * 覆い切った瞬間に下のコンテンツをバトル画面へ差し替えて、逆再生で開く。
 *
 * 使い方 (world.tsx / trial-arena.tsx):
 *   phase: 'cover'  — 元画面の上でタイルが閉じていく
 *   phase: 'hold'   — 全面黒のまま待機 (支払い通信が cover より長いときのつなぎ)
 *   phase: 'reveal' — バトル画面の上でタイルが開いていく (cover より短くテンポ優先)
 *   onCoverDone     — 覆い切ったら 1 回呼ばれる (ここで下をバトル画面に差し替える)
 *   onRevealDone    — 開き切ったら 1 回呼ばれる (ここでオーバーレイを外す)
 *   onHoldTimeout   — hold が HOLD_TIMEOUT_MS 続いたら 1 回呼ばれる (通信ハングの脱出口。
 *                     親は遭遇キャンセル + reveal に倒す)
 *   holdMessage     — hold が長引いたとき全面黒に出す一行 (CSS 側で 1.2s 後にフェードイン)
 *
 * **親側の契約**: cover/hold の間は下のコンテンツを差し替えないこと (覆い切る前に
 * バトル画面が見えると演出が崩れる)。reveal になってから差し替える。
 *
 * prefers-reduced-motion では CSS 側で実質ゼロ時間になり、パッと切り替わる
 * (酔い・点滅対策。挙動フローは同じなのでロジック分岐は不要)。
 */

export type WipePhase = 'cover' | 'hold' | 'reveal';

/** タイル 1 辺の目安 px。列/行に上限を設け、大画面ではタイルが大きくなる
 *  (無制限だと 4K で約 2700 レイヤーになる — レビュー指摘)。 */
const TILE_PX = 56;
const MAX_COLS = 24;
const MAX_ROWS = 16;
/** 全タイルの開始遅延の総量 (ms)。画面サイズによらず演出時間を一定に保つ
 *  (距離 × 固定 ms だとデスクトップで往復 3〜4.5 秒に間延びする — レビュー指摘)。
 *  reveal は cover より短くしてテンポを締める (本家 DQ1 に reveal は無いので控えめに)。 */
const COVER_STAGGER_MS = 450;
const REVEAL_STAGGER_MS = 220;
/** 1 タイルのアニメ時間 (styles.css の .enc-cover / .enc-reveal と一致させる)。 */
const COVER_TILE_MS = 400;
const REVEAL_TILE_MS = 280;
/** hold の上限。支払い通信がハングしたとき全面黒で無限ロックしないための脱出口。 */
const HOLD_TIMEOUT_MS = 10000;

export function EncounterWipe({
  phase,
  holdMessage,
  onCoverDone,
  onRevealDone,
  onHoldTimeout,
}: {
  phase: WipePhase;
  holdMessage?: string;
  onCoverDone?: () => void;
  onRevealDone?: () => void;
  onHoldTimeout?: () => void;
}) {
  // グリッドはマウント時の viewport から決める (回転などでの再計算はしない —
  // 演出は 1 秒強で終わるので過剰対応しない)
  const grid = useMemo(() => {
    const w = typeof window !== 'undefined' ? window.innerWidth : 375;
    const h = typeof window !== 'undefined' ? window.innerHeight : 667;
    const cols = Math.min(MAX_COLS, Math.max(4, Math.ceil(w / TILE_PX)));
    const rows = Math.min(MAX_ROWS, Math.max(4, Math.ceil(h / TILE_PX)));
    return { cols, rows };
  }, []);

  // 完了/タイムアウト通知は timeout で 1 回だけ発火する
  // (onAnimationEnd はタイル数ぶん飛んでくるので使わない)
  const coverDoneRef = useRef(onCoverDone);
  coverDoneRef.current = onCoverDone;
  const revealDoneRef = useRef(onRevealDone);
  revealDoneRef.current = onRevealDone;
  const holdTimeoutRef = useRef(onHoldTimeout);
  holdTimeoutRef.current = onHoldTimeout;
  // reduced-motion では delay/duration がほぼ 0 なので、完了通知も即時に近づける
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (phase === 'hold') {
      const t = setTimeout(() => holdTimeoutRef.current?.(), HOLD_TIMEOUT_MS);
      return () => clearTimeout(t);
    }
    const total = reduced
      ? 30
      : phase === 'cover'
        ? COVER_STAGGER_MS + COVER_TILE_MS + 60
        : REVEAL_STAGGER_MS + REVEAL_TILE_MS + 60;
    const t = setTimeout(() => {
      if (phase === 'cover') coverDoneRef.current?.();
      else revealDoneRef.current?.();
    }, total);
    return () => clearTimeout(t);
  }, [phase, reduced]);

  // タイル生成: 中心から外へ「渦を巻く」順に発火する (DQ1 の渦巻きワイプ)。
  // リング (チェビシェフ距離) + 角度で渦の進行度 0..1 を作り、stagger 総量に正規化。
  const { cols, rows } = grid;
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const maxRing = Math.max(cx, cy) + 1;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ring = Math.max(Math.abs(c - cx), Math.abs(r - cy));
      const angle = (Math.atan2(r - cy, c - cx) + Math.PI) / (2 * Math.PI); // 0..1
      const frac = Math.min(1, (ring + angle) / maxRing);
      tiles.push(
        <div
          key={`${c}-${r}`}
          className="enc-tile"
          style={{
            left: `${(c / cols) * 100}%`,
            top: `${(r / rows) * 100}%`,
            width: `${100 / cols}%`,
            height: `${100 / rows}%`,
            ['--dc' as string]: `${Math.round(frac * COVER_STAGGER_MS)}ms`,
            ['--dr' as string]: `${Math.round(frac * REVEAL_STAGGER_MS)}ms`,
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
        zIndex: 1000, // footer-nav 含む全 UI より上 (戦闘導入中の誤タップも物理的に防ぐ)
        pointerEvents: 'auto', // 演出中の下要素タップを吸う
        overflow: 'hidden',
      }}
    >
      {tiles}
      {phase === 'hold' && holdMessage && (
        // hold が長引いたときだけ見える (CSS で 1.2s 後フェードイン + ▼ 点滅)。
        // 「真っ黒のまま無反応」に見せない (レビュー指摘)。
        <div className="enc-hold-msg">{holdMessage}</div>
      )}
    </div>
  );
}
