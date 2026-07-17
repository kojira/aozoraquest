import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EQUIPMENT_BY_ID,
  ITEMS,
  canEquip,
  craftedName,
  isMasterwork,
  jobDisplayName,
  townShopStock,
  type Archetype,
  type EquipmentDef,
  type Town,
} from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';

/**
 * なんでも屋 (docs/20, W6b)。街に入ると開ける制作モーダル。
 *
 * 「購入」ではなく**制作**: パワー + 素材を渡して作ってもらう。できあがりの
 * 品質 (0〜100) は制作時の luk が下限を引き上げる (「うんが高いほど下振れ
 * しにくい」— gamble・敗北ドロップと同じ設計言語。オーナー決定 2026-07-18)。
 * 装備できない品も制作・所持は可能 (転職準備 / クエスト交換の材料 — docs/20)。
 */

const STAT_LABELS: Record<string, string> = {
  atk: 'こうげき',
  def: 'まもり',
  agi: 'すばやさ',
  int: 'かしこさ',
  luk: 'うん',
  maxHp: 'さいだいHP',
};

function bonusText(def: EquipmentDef): string {
  return Object.entries(def.bonus)
    .map(([k, v]) => `${STAT_LABELS[k] ?? k} +${v}`)
    .join(' ');
}

export function ShopModal({
  town,
  townIndex,
  archetype,
  luk,
  balance,
  materials,
  craftedCounts,
  busy,
  lastResult,
  onCraft,
  onClose,
}: {
  town: Town;
  townIndex: number;
  archetype: Archetype | null;
  /** 制作時の luk (品質の下限に効く) */
  luk: number;
  balance: number;
  materials: Record<string, number>;
  /** 既に作った数 (itemId → 個数) */
  craftedCounts: Record<string, number>;
  busy: boolean;
  /** 直近の制作結果 (演出用) */
  lastResult: CraftedPiece | null;
  onCraft: (def: EquipmentDef) => void;
  onClose: () => void;
}) {
  const stock = useMemo(() => townShopStock(town, townIndex), [town, townIndex]);
  const materialName = ITEMS[stock.materialId]?.name ?? stock.materialId;
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
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
      aria-label="なんでも屋"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1em',
      }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: 10,
          width: 'min(94vw, 520px)',
          maxHeight: '86svh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <strong style={{ fontSize: '0.95em' }}>🔨 {town.name} のなんでも屋</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <p style={{ margin: '0 0 0.5em', fontSize: '0.75em', color: 'var(--color-muted)' }}>
          パワーと素材をわたすと、その場で作ってもらえるよ。うんが高いと良い品ができやすい。
          <br />
          もちもの: パワー <strong style={{ color: 'var(--color-fg)' }}>{balance}</strong> / {materialName}{' '}
          <strong style={{ color: 'var(--color-fg)' }}>×{materials[stock.materialId] ?? 0}</strong>
        </p>
        {lastResult && (
          <p
            aria-live="polite"
            style={{
              margin: '0 0 0.5em',
              fontSize: '0.85em',
              fontWeight: 700,
              color: isMasterwork(lastResult.quality) ? 'var(--color-accent)' : 'var(--color-fg)',
            }}
          >
            {isMasterwork(lastResult.quality) ? '✨ ' : ''}
            {craftedName(EQUIPMENT_BY_ID[lastResult.itemId]!, lastResult.quality)} ができた! (品質 {lastResult.quality})
          </p>
        )}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stock.equipment.map((id) => {
            const def = EQUIPMENT_BY_ID[id];
            if (!def) return null;
            const equipable = archetype ? canEquip(archetype, def) : false;
            const affordable = balance >= def.price.power && (materials[stock.materialId] ?? 0) >= def.price.materials;
            const owned = craftedCounts[id] ?? 0;
            return (
              <div
                key={id}
                style={{
                  border: '2px solid var(--color-border)',
                  borderRadius: 4,
                  padding: '0.4em 0.6em',
                  fontSize: '0.85em',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5em',
                  opacity: affordable ? 1 : 0.65,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong>{def.name}</strong>
                    {owned > 0 && <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>所持 {owned}</span>}
                  </div>
                  <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
                    {bonusText(def)}
                    {def.jobOnly && (
                      <span style={{ marginLeft: '0.5em', color: equipable ? 'var(--color-accent)' : 'var(--color-danger)' }}>
                        (要: {jobDisplayName(def.jobOnly, 'default')})
                      </span>
                    )}
                    {!def.jobOnly && !equipable && (
                      <span style={{ marginLeft: '0.5em' }}>(いまのジョブでは装備できない)</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85em' }}>
                    パワー {def.price.power} + {materialName} ×{def.price.materials}
                  </div>
                </div>
                {confirmId === id ? (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      disabled={busy || !affordable}
                      onClick={() => {
                        setConfirmId(null);
                        onCraft(def);
                      }}
                      style={{ fontSize: '0.85em', padding: '0.4em 0.8em' }}
                    >
                      つくる!
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setConfirmId(null)}
                      style={{ fontSize: '0.85em', padding: '0.4em 0.6em' }}
                    >
                      やめる
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !affordable}
                    onClick={() => setConfirmId(id)}
                    style={{ fontSize: '0.85em', padding: '0.4em 0.9em', whiteSpace: 'nowrap' }}
                  >
                    つくってもらう
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
