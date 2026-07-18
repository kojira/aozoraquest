import { useEffect, useMemo, useRef } from 'react';
import { townAt } from '@aozoraquest/core';

/**
 * そらのはねの行き先えらび (オーナー要望 2026-07-18「過去に行ったことのある街を
 * 選択できるように」)。訪問済みの街から飛び先を選ぶ。今いる街は候補から外す。
 */
export function FeatherModal({
  visitedTowns,
  current,
  onSelect,
  onClose,
}: {
  visitedTowns: { x: number; y: number }[];
  current: { x: number; y: number };
  onSelect: (dest: { x: number; y: number }) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 今いる街を除き、実在する街だけ。名前つきで新しい順 (末尾=最近訪問) に上へ
  const dests = useMemo(() => {
    const out: { x: number; y: number; name: string }[] = [];
    for (let i = visitedTowns.length - 1; i >= 0; i--) {
      const v = visitedTowns[i]!;
      if (v.x === current.x && v.y === current.y) continue;
      const t = townAt(v.x, v.y);
      if (t) out.push({ x: v.x, y: v.y, name: t.name });
    }
    return out;
  }, [visitedTowns, current]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="そらのはね"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em' }}
    >
      <div className="dq-window" onClick={(e) => e.stopPropagation()} style={{ padding: 10, width: 'min(94vw, 380px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>そらのはね</strong>
          <button ref={closeRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        {dests.length > 0 && (
          <p style={{ margin: '0 0 0.5em', fontSize: '0.78em', color: 'var(--color-muted)' }}>行ったことのある街へ もどれる。</p>
        )}
        {dests.length === 0 ? (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>まだ 行き先がない。街を おとずれると えらべるよ。</p>
        ) : (
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dests.map((d) => (
              <button
                key={`${d.x},${d.y}`}
                type="button"
                onClick={() => {
                  onClose();
                  onSelect({ x: d.x, y: d.y });
                }}
                style={{ padding: '0.5em 0.9em', fontSize: '0.9em', textAlign: 'left', touchAction: 'manipulation' }}
              >
                🏘 {d.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
