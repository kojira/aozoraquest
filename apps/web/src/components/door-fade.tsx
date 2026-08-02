import { useEffect, useRef } from 'react';

/**
 * **街の出入りの演出** (#626)。戦闘の渦巻きワイプ (encounter-wipe) とは**別物**にする —
 * 同じ演出だと「敵が出た」と誤解する (オーナー指摘)。
 *
 * 戦闘は黒いタイルが渦を巻いて閉じる荒い演出。こちらは**扉をくぐる**イメージで、
 * 白い光がふわっと満ちて引く柔らかいフェードにする。
 *
 * 使い方 (world.tsx):
 *   phase: 'in'  — 元の画面の上で光が満ちる (満ちたら onCovered で位置を差し替える)
 *   phase: 'out' — 新しい画面の上で光が引く (引き切ったら onDone)
 *
 * prefers-reduced-motion では CSS 側で実質ゼロ時間になり、パッと切り替わる。
 */
export type DoorFadePhase = 'in' | 'out';

/** styles.css の .door-fade-in / .door-fade-out と一致させる。 */
const IN_MS = 280;
const OUT_MS = 320;

export function DoorFade({ phase, onCovered, onDone }: {
  phase: DoorFadePhase;
  onCovered?: () => void;
  onDone?: () => void;
}) {
  // 1 フェーズにつき 1 回だけ呼ぶ (StrictMode の二重実行でも二重に進めない)。
  const firedFor = useRef<DoorFadePhase | null>(null);
  useEffect(() => {
    if (firedFor.current === phase) return;
    firedFor.current = phase;
    const cb = phase === 'in' ? onCovered : onDone;
    const t = setTimeout(() => cb?.(), phase === 'in' ? IN_MS : OUT_MS);
    return () => clearTimeout(t);
  }, [phase, onCovered, onDone]);

  return (
    <div
      className={phase === 'in' ? 'door-fade door-fade-in' : 'door-fade door-fade-out'}
      // 演出中に下の地図を触らせない (歩けてしまうと位置がずれる)。
      aria-hidden
    />
  );
}
