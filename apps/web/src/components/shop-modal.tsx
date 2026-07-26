import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CRAFT_TUNING,
  EQUIPMENT_BY_ID,
  ITEMS,
  MONSTERS,
  SALE_TUNING,
  canEquip,
  forgedLevel,
  isMasterwork,
  isSellableMaterial,
  jobDisplayName,
  leveledName,
  salePowerFor,
  townShopStock,
  type Archetype,
  type EquipmentDef,
  type Town,
} from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';

/**
 * なんでも屋 (docs/20, W6b)。街に入ると開ける制作 + 合成モーダル。
 *
 * - **制作** (つくってもらう): パワー + 素材をわたす。できあがりの強化値は
 *   −1〜+5 で、制作時の luk が下限を引き上げる (「うんが高いほど下振れしにくい」)。
 * - **合成** (きたえてもらう): 同じアイテム・同じ強化値 2 つ → +1。+6 以上への
 *   唯一の道 = 過剰なアイテムを燃やすシンク (オーナー決定 2026-07-18)。
 * - 装備できない品も制作・所持は可能 (転職準備 / クエスト交換の材料 — docs/20)。
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

export interface LastShopAction {
  piece: CraftedPiece;
  kind: 'craft' | 'forge';
}

/** アイテムごとの「合成できる最良の組」(同強化値 2 個体の最大レベル)。
 *  装備中の個体は候補から除外 (そうび中の武器が黙って燃えるのを防ぐ)。 */
function bestForgePair(pieces: CraftedPiece[], equippedRkeys: readonly string[]): { level: number; rkeys: [string, string] } | null {
  const equipped = new Set(equippedRkeys);
  const byLevel = new Map<number, CraftedPiece[]>();
  for (const p of pieces) {
    if (equipped.has(p.rkey)) continue;
    if (p.level >= CRAFT_TUNING.levelMax) continue;
    const list = byLevel.get(p.level) ?? [];
    list.push(p);
    byLevel.set(p.level, list);
  }
  let best: { level: number; rkeys: [string, string] } | null = null;
  for (const [level, list] of byLevel) {
    if (list.length >= 2 && (!best || level > best.level)) {
      best = { level, rkeys: [list[0]!.rkey, list[1]!.rkey] };
    }
  }
  return best;
}

export function ShopModal({
  town,
  townIndex,
  archetype,
  balance,
  materials,
  pieces,
  equippedRkeys,
  busy,
  lastAction,
  errorText,
  onCraft,
  onForge,
  onSell,
  onClose,
}: {
  town: Town;
  townIndex: number;
  archetype: Archetype | null;
  balance: number;
  materials: Record<string, number>;
  /** 所持している制作品 (強化値つき個体) */
  pieces: CraftedPiece[];
  /** 装備中の個体 rkey (合成候補から除外する) */
  equippedRkeys: readonly string[];
  busy: boolean;
  lastAction: LastShopAction | null;
  /** 失敗の理由 (#551)。**モーダル内に出す** — ページ本体の通知行に出しても、
   *  この全画面オーバーレイの背面に描かれてプレイヤーには見えない。 */
  errorText: string | null;
  onCraft: (def: EquipmentDef) => void;
  onForge: (def: EquipmentDef, level: number, rkeys: [string, string]) => void;
  /** 素材のひきとり (count は materialsPerPower の倍数) */
  onSell: (materialId: string, count: number) => void;
  onClose: () => void;
}) {
  const stock = useMemo(() => townShopStock(town, townIndex), [town, townIndex]);
  const materialName = ITEMS[stock.materialId]?.name ?? stock.materialId;
  // 値札素材を落とすモンスター (店プールは全て単一モンスターの固有ドロップ)
  const dropperName = MONSTERS.find((m) => m.drops.some((d) => d.item === stock.materialId))?.name;
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const piecesByItem = useMemo(() => {
    const m = new Map<string, CraftedPiece[]>();
    for (const p of pieces) {
      const list = m.get(p.itemId) ?? [];
      list.push(p);
      m.set(p.itemId, list);
    }
    return m;
  }, [pieces]);

  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lastDef = lastAction ? EQUIPMENT_BY_ID[lastAction.piece.itemId] : null;

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
          パワーと素材をわたすと作ってもらえる (できばえは −1〜+5、うんが高いと良い品に)。
          同じ品を 2 つわたすと 1 つ上にきたえてもらえる (+6 から上はきたえるだけ)。
          <br />
          もちもの: パワー <strong style={{ color: 'var(--color-fg)' }}>{balance}</strong> / {materialName}{' '}
          <strong style={{ color: 'var(--color-fg)' }}>×{materials[stock.materialId] ?? 0}</strong>
          <br />
          ({materialName}は このあたりの {dropperName ?? 'モンスター'}が おとす)
        </p>
        {/* live region は常設して中身を差し替える (条件付きマウントは初回読み上げが
            落ちることがある — レビュー指摘) */}
        <p
          aria-live="polite"
          style={{
            margin: '0 0 0.5em',
            fontSize: '0.85em',
            fontWeight: 700,
            minHeight: '1.4em',
            color: errorText
              ? 'var(--color-danger, #e8566a)'
              : lastAction && isMasterwork(lastAction.piece.level) ? 'var(--color-accent)' : 'var(--color-fg)',
          }}
        >
          {errorText ? errorText : lastAction && lastDef && (
            <>
              {isMasterwork(lastAction.piece.level) ? '✨ ' : ''}
              {leveledName(lastDef, lastAction.piece.level)}
              {lastAction.kind === 'forge' ? ' に きたえあげた!' : ' ができた!'}
            </>
          )}
        </p>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {stock.equipment.map((id) => {
            const def = EQUIPMENT_BY_ID[id];
            if (!def) return null;
            const equipable = archetype ? canEquip(archetype, def) : false;
            const affordable = balance >= def.price.power && (materials[stock.materialId] ?? 0) >= def.price.materials;
            const owned = piecesByItem.get(id) ?? [];
            const forge = bestForgePair(owned, equippedRkeys);
            // 装備を外せば鍛えられる組があるのに、装備中除外で不成立の場合の注記
            const forgeBlockedByEquip = !forge && bestForgePair(owned, []) !== null;
            const bestOwned = owned.length > 0 ? Math.max(...owned.map((p) => p.level)) : null;
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
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong>{def.name}</strong>
                    {owned.length > 0 && (
                      <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>
                        所持 {owned.length}{bestOwned !== null && bestOwned !== 0 ? ` (最高${bestOwned > 0 ? `+${bestOwned}` : bestOwned})` : ''}
                      </span>
                    )}
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
                  <div style={{ fontSize: '0.85em', opacity: affordable ? 1 : 0.65 }}>
                    パワー {def.price.power} + {materialName} ×{def.price.materials}
                  </div>
                </div>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
                  {confirmId === id ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {!equipable && (
                        <span style={{ fontSize: '0.72em', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                          いまは装備できないけど
                        </span>
                      )}
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
                  {forge && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onForge(def, forgedLevel(forge.level), forge.rkeys)}
                      style={{ fontSize: '0.8em', padding: '0.35em 0.7em', whiteSpace: 'nowrap' }}
                    >
                      きたえる ({forge.level > 0 ? `+${forge.level}` : forge.level}×2 → +{forgedLevel(forge.level)})
                    </button>
                  )}
                  {forgeBlockedByEquip && (
                    <span style={{ fontSize: '0.7em', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>
                      そうびを外すと きたえられる
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {/* 素材のひきとり (素材 → パワー。レートは無限ループ防止で低め — docs/20) */}
          {(() => {
            const sellable = Object.entries(materials).filter(
              ([id, n]) => isSellableMaterial(id) && n >= SALE_TUNING.materialsPerPower,
            );
            if (sellable.length === 0) return null;
            return (
              <div style={{ border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em' }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>素材のひきとり</strong>{' '}
                  <span style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>
                    ({SALE_TUNING.materialsPerPower} 個 = パワー 1)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sellable.map(([id, n]) => {
                    const power = salePowerFor(n);
                    const count = power * SALE_TUNING.materialsPerPower;
                    return (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
                        <span>
                          {ITEMS[id]?.name ?? id} ×{n}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onSell(id, count)}
                          style={{ fontSize: '0.85em', padding: '0.35em 0.8em', whiteSpace: 'nowrap' }}
                        >
                          ×{count} ひきとり → パワー {power}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
