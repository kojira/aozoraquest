import { useEffect, useRef, useState } from 'react';
import { EQUIPMENT_BY_ID, ITEMS, leveledName } from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';

/**
 * あおぞらワールドのコマンドメニューから開く 2 つの窓 (docs/19 オーバーレイ化)。
 * - ItemsModal (どうぐ): 消耗品を使う (やくそう / そらのしずく / そらのはね)
 * - InventoryModal (もちもの): 素材 + 制作品の一覧 (読み取り専用)
 *
 * モーダルは画面全面 (fixed) に出す。コマンドメニュー自体はマップ上オーバーレイ
 * だが、内容の多い窓は既存モーダル (gear/status 等) と同じ全面ダイアログに寄せる。
 */

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em' }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 10, width: 'min(94vw, 420px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>{title}</strong>
          <button ref={closeRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}

export function ItemsModal({
  herbStock,
  tonicStock,
  featherStock,
  canUse,
  onUseHerb,
  onUseTonic,
  onUseFeather,
  onClose,
}: {
  herbStock: number;
  tonicStock: number;
  featherStock: number;
  /** 戦闘値が解決済み (HP/MP 回復が計算できる) か */
  canUse: boolean;
  onUseHerb: () => string | void;
  onUseTonic: () => string | void;
  onUseFeather: () => void;
  onClose: () => void;
}) {
  // 回復系は使っても閉じない (満タン等の結果をモーダル内に留めて見せる — レビュー ★★)。
  // そらのはねは街へ帰る (テレポート) ので閉じる。
  const [msg, setMsg] = useState<string | null>(null);
  const row = (label: string, count: number, note: string, disabled: boolean, onUse: () => string | void, closeAfter: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em', padding: '0.4em 0', borderBottom: '1px solid var(--color-border)' }}>
      <span style={{ fontSize: '0.9em' }}>
        {label} <span style={{ color: 'var(--color-muted)' }}>×{count}</span>
        <br />
        <span style={{ fontSize: '0.78em', color: 'var(--color-muted)' }}>{note}</span>
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const r = onUse();
          if (closeAfter) onClose();
          else setMsg(typeof r === 'string' ? r : null);
        }}
        style={{ fontSize: '0.82em', padding: '0.4em 1em', touchAction: 'manipulation' }}
      >
        つかう
      </button>
    </div>
  );
  return (
    <ModalShell title="どうぐ" onClose={onClose}>
      {herbStock <= 0 && tonicStock <= 0 && featherStock <= 0 ? (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>どうぐを もっていない。モンスターを たおすと 手に入る。</p>
      ) : (
        <>
          {row('やくそう', herbStock, 'HP を かいふく', herbStock <= 0 || !canUse, onUseHerb, false)}
          {row('そらのしずく', tonicStock, 'MP を かいふく', tonicStock <= 0 || !canUse, onUseTonic, false)}
          {row('そらのはね', featherStock, '街へ もどる', featherStock <= 0, onUseFeather, true)}
          <p aria-live="polite" style={{ fontSize: '0.82em', minHeight: '1.4em', margin: '0.4em 0 0', color: 'var(--color-fg)' }}>
            {msg}
          </p>
        </>
      )}
    </ModalShell>
  );
}

export function InventoryModal({
  materials,
  pieces,
  onClose,
}: {
  materials: Record<string, number>;
  pieces: CraftedPiece[];
  onClose: () => void;
}) {
  const mats = Object.entries(materials).filter(([, n]) => n > 0);
  const sortedPieces = [...pieces].sort((a, b) => b.level - a.level);
  return (
    <ModalShell title="もちもの" onClose={onClose}>
      <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0 0 2px' }}>そざい</div>
      {mats.length === 0 ? (
        <p style={{ fontSize: '0.82em', color: 'var(--color-muted)' }}>そざいは まだ ない。</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em 0.8em', fontSize: '0.85em', marginBottom: '0.6em' }}>
          {mats.map(([id, n]) => (
            <span key={id}>
              {ITEMS[id]?.name ?? id} <span style={{ color: 'var(--color-muted)' }}>×{n}</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 2px' }}>つくった そうび</div>
      {sortedPieces.length === 0 ? (
        <p style={{ fontSize: '0.82em', color: 'var(--color-muted)' }}>まだ ない。なんでも屋で つくってもらおう。</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85em' }}>
          {sortedPieces.map((p) => {
            const def = EQUIPMENT_BY_ID[p.itemId];
            return <div key={p.rkey}>{def ? leveledName(def, p.level) : p.itemId}</div>;
          })}
        </div>
      )}
    </ModalShell>
  );
}
