import { useEffect, useRef, useState } from 'react';
import { EQUIPMENT_BY_ID, ITEMS, leveledName, withCharacterNames } from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';
import type { FieldMember } from './field-skill-modal';

/**
 * あおぞらワールドのコマンドメニューから開く 2 つの窓 (docs/19 オーバーレイ化)。
 * - ItemsModal (どうぐ): 消耗品を使う (やくそう / そらのしずく / そらのはね)
 * - InventoryModal (もちもの): 素材 + 制作品の一覧 (読み取り専用)
 *
 * モーダルは画面全面 (fixed) に出す。コマンドメニュー自体はマップ上オーバーレイ
 * だが、内容の多い窓は既存モーダル (gear/status 等) と同じ全面ダイアログに寄せる。
 */

export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
  members = [],
  onUseOnAlly,
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
  /** 主人公 ('hero') と仲間。仲間がいれば やくそう・しずくは相手を選ぶ (D-PARTY-003)。 */
  members?: readonly FieldMember[];
  onUseOnAlly?: (item: 'herb' | 'tonic', ally: FieldMember) => Promise<string>;
}) {
  // 回復系は使っても閉じない (満タン等の結果をモーダル内に留めて見せる — レビュー ★★)。
  // そらのはねは街へ帰る (テレポート) ので閉じる。
  const [msg, setMsg] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<'herb' | 'tonic' | null>(null);
  const [busy, setBusy] = useState(false);
  const withAllies = members.length > 1 && !!onUseOnAlly;
  const applyTo = async (item: 'herb' | 'tonic', m: FieldMember) => {
    setChoosing(null);
    if (m.id === 'hero') { const r = (item === 'herb' ? onUseHerb : onUseTonic)(); setMsg(typeof r === 'string' ? r : null); return; }
    setBusy(true);
    setMsg(await onUseOnAlly!(item, m));
    setBusy(false);
  };
  if (choosing) {
    const full = (m: FieldMember) => (choosing === 'herb' ? m.c.hp >= m.c.maxHp : m.c.mp >= m.c.maxMp);
    return (
      <ModalShell title="どうぐ" onClose={onClose}>
        <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0 0 2px' }}>{choosing === 'herb' ? 'やくそう' : 'そらのしずく'}を だれに つかう？</div>
        {members.map((m) => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em', padding: '0.4em 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.9em', opacity: m.c.hp <= 0 ? 0.5 : 1 }}>
            <span>{m.c.name}<br /><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85em', color: 'var(--color-muted)' }}>HP {m.c.hp}/{m.c.maxHp}　MP {m.c.mp}/{m.c.maxMp}</span></span>
            <button type="button" disabled={busy || m.c.hp <= 0 || full(m)} onClick={() => void applyTo(choosing, m)} style={{ fontSize: '0.82em', padding: '0.4em 1em', touchAction: 'manipulation' }}>
              {m.c.hp <= 0 ? 'たおれている' : full(m) ? 'まんたん' : 'つかう'}
            </button>
          </div>
        ))}
        <div style={{ marginTop: '0.4em' }}><button type="button" onClick={() => setChoosing(null)} style={{ fontSize: '0.82em', padding: '0.4em 1em' }}>もどる</button></div>
      </ModalShell>
    );
  }
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
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>どうぐを持っていない。モンスターを倒すと手に入る。</p>
      ) : (
        <>
          {row('やくそう', herbStock, 'HPを回復', busy || herbStock <= 0 || !canUse, withAllies ? () => setChoosing('herb') : onUseHerb, false)}
          {row('そらのしずく', tonicStock, 'MPを回復', busy || tonicStock <= 0 || !canUse, withAllies ? () => setChoosing('tonic') : onUseTonic, false)}
          {row('そらのはね', featherStock, '行った街へ飛ぶ', featherStock <= 0, onUseFeather, true)}
          {featherStock <= 0 && (
            <p style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.2em 0 0' }}>
              そらのはねは戦いでまれに手に入る。
            </p>
          )}
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
  // 戦闘で使うどうぐ (D-ITEM-001) は素材と分けて、使い道の 1 行を添える。
  const mats = Object.entries(materials).filter(([id, n]) => n > 0 && !ITEMS[id]?.battle);
  const battleItems = Object.entries(materials).filter(([id, n]) => n > 0 && ITEMS[id]?.battle);
  const sortedPieces = [...pieces].sort((a, b) => b.level - a.level);
  return (
    <ModalShell title="もちもの" onClose={onClose}>
      <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0 0 2px' }}>そざい</div>
      {mats.length === 0 ? (
        <p style={{ fontSize: '0.82em', color: 'var(--color-muted)' }}>素材はまだない。</p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em 0.8em', fontSize: '0.85em', marginBottom: '0.6em' }}>
          {mats.map(([id, n]) => (
            <span key={id}>
              {withCharacterNames(ITEMS[id]?.name ?? id)} <span style={{ color: 'var(--color-muted)' }}>×{n}</span>
            </span>
          ))}
        </div>
      )}
      {battleItems.length > 0 && (
        <>
          <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 2px' }}>戦闘でつかう どうぐ</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85em', marginBottom: '0.6em' }}>
            {battleItems.map(([id, n]) => (
              <div key={id}>
                {withCharacterNames(ITEMS[id]!.name)} <span style={{ color: 'var(--color-muted)' }}>×{n}</span>
                {ITEMS[id]!.desc && <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>{ITEMS[id]!.desc}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', margin: '0.4em 0 2px' }}>作った装備</div>
      {sortedPieces.length === 0 ? (
        <p style={{ fontSize: '0.82em', color: 'var(--color-muted)' }}>まだない。なんでも屋で作ってもらおう。</p>
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
