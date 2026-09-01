import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EQUIPMENT_BY_ID,
  canEquip,
  GEAR_SLOTS,
  GEAR_SLOT_LABELS,
  bonusText,
  equipHands,
  gearBonusFromGear,
  jobDisplayName,
  leveledName,
  type Archetype,
  type EquipSlot,
  type GearSelection,
} from '@aozoraquest/core';
import type { CraftedPiece } from '@/lib/crafting';
import { resolveGear, type GearRefs } from '@/lib/gear';

/**
 * そうび画面 (docs/20 W6c)。3 スロット (武器/防具/お守り) の着脱。
 * 装備は craft/forge 個体の rkey 参照で保存する (強化値は直書きしない)。
 */

const SLOT_LABELS = GEAR_SLOT_LABELS;

export function GearModal({
  archetype,
  pieces,
  refs,
  onEquip,
  onUnequip,
  onDiscard,
  busy = false,
  errorText = null,
  onClose,
}: {
  archetype: Archetype | null;
  /** 所持している全個体 */
  pieces: CraftedPiece[];
  /** 現在の装備参照 */
  refs: GearRefs;
  onEquip: (slot: EquipSlot, rkey: string) => void;
  onUnequip: (slot: EquipSlot) => void;
  /** すてる (#575)。所持上限があるので整理できないと詰む。街の外でもできる。 */
  onDiscard: (rkey: string) => void;
  busy?: boolean;
  /** 失敗の理由。**ここに出さないと街の外では表示先が無い** — ShopModal は街に居るときしか
   *  描画されず、すてるの主用途は街の外なので、無反応になってユーザーが連打する。 */
  errorText?: string | null;
  onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  // すてるは取り消せないので 2 段階。強化した品を 1 タップで失わせない。
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const byRkey = useMemo(() => new Map(pieces.map((p) => [p.rkey, p])), [pieces]);

  // 現装備の解決 (lib/gear.ts の resolveGear を再利用 — 失効条件の単一出所)
  const resolved = useMemo(() => resolveGear(refs, pieces, archetype), [refs, pieces, archetype]);
  const selection: GearSelection = resolved.selection;

  const total = useMemo(() => (archetype ? gearBonusFromGear(archetype, selection) : null), [archetype, selection]);
  const totalText = total ? bonusText(total) : '';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="そうび"
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
        style={{ padding: 10, width: 'min(94vw, 520px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <strong style={{ fontSize: '0.95em' }}>⚔ そうび</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <p style={{ margin: '0 0 0.5em', fontSize: '0.75em', color: 'var(--color-muted)', minHeight: '1.4em' }} aria-live="polite">
          {totalText ? `そうびの効果: ${totalText}` : 'なにも装備していない。なんでも屋で作ってもらおう。'}
        </p>
        {errorText && (
          <p role="alert" style={{ fontSize: '0.85em', color: 'var(--color-danger)', margin: '0 0 0.4em' }}>
            {errorText}
          </p>
        )}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GEAR_SLOTS.map((slot) => {
            const equippedRkey = refs[slot];
            const equipped = equippedRkey ? byRkey.get(equippedRkey) : undefined;
            const equippedDef = equipped ? EQUIPMENT_BY_ID[equipped.itemId] : undefined;
            const candidates = pieces
              .filter((p) => EQUIPMENT_BY_ID[p.itemId]?.slot === slot)
              .sort((a, b) => b.level - a.level);
            // 手数 (#609): core は超過時**必ず盾を落とす**ので、案内も盾側にだけ出す
            // (武器側に出すと「効いているのに塞がっている」の誤情報になる — レビュー ★★★)。
            const weaponDef = refs.weapon ? EQUIPMENT_BY_ID[byRkey.get(refs.weapon)?.itemId ?? ''] : undefined;
            const handsBlocked = slot === 'shield' && weaponDef && equipHands(weaponDef) >= 2;
            return (
              <div key={slot} style={{ border: '2px solid var(--color-border)', borderRadius: 4, padding: '0.4em 0.6em', fontSize: '0.85em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span>
                    <strong>{SLOT_LABELS[slot]}</strong>:{' '}
                    {equipped && equippedDef ? leveledName(equippedDef, equipped.level) : 'なし'}
                    {/* 参照は残っているが失効中 (転職などで装備不可) の注記 —
                        「そうび中なのに効果なし」の矛盾を可視化 (レビュー指摘) */}
                    {equipped && !resolved.pieces[slot] && (
                      <span style={{ marginLeft: '0.4em', fontSize: '0.85em', color: 'var(--color-danger)' }}>
                        {/* 失効理由を正しく言う — 手数で外れた盾に「ジョブでは効果なし」と
                            出すとジョブが原因だと誤診させる (レビュー ★★★) */}
                        {handsBlocked ? '(りょうてが ふさがっていて 効果なし)' : '(いまのジョブでは効果なし)'}
                      </span>
                    )}
                  </span>
                  {equipped && (
                    <button type="button" onClick={() => onUnequip(slot)} style={{ fontSize: '0.8em', padding: '0.3em 0.7em' }}>
                      はずす
                    </button>
                  )}
                </div>
                {handsBlocked && !equipped && (
                  <div style={{ color: 'var(--color-muted)', fontSize: '0.85em', marginBottom: 4 }}>
                    りょうてが ふさがっている (たてを そうびすると ぶきが はずれる)
                  </div>
                )}
                {candidates.length === 0 ? (
                  <div style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>もっていない</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {candidates.map((p) => {
                      const def = EQUIPMENT_BY_ID[p.itemId]!;
                      const equipable = archetype ? canEquip(archetype, def) : false;
                      const isEquipped = p.rkey === equippedRkey;
                      return (
                        <div key={p.rkey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em' }}>
                          <span style={{ opacity: equipable ? 1 : 0.6 }}>
                            {leveledName(def, p.level)}
                            {equipHands(def) === 2 && <span style={{ marginLeft: '0.3em', fontSize: '0.85em', color: 'var(--color-muted)' }}>(両手)</span>}
                            {def.jobOnly && !equipable && (
                              <span style={{ marginLeft: '0.4em', fontSize: '0.85em', color: 'var(--color-danger)' }}>
                                (要: {jobDisplayName(def.jobOnly, 'default')})
                              </span>
                            )}
                            {!def.jobOnly && !equipable && (
                              <span style={{ marginLeft: '0.4em', fontSize: '0.85em', color: 'var(--color-muted)' }}>(装備できない)</span>
                            )}
                          </span>
                          {isEquipped ? (
                            <span style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>そうび中</span>
                          ) : confirmDiscard === p.rkey ? (
                            <span style={{ display: 'flex', gap: '0.3em', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setConfirmDiscard(null); onDiscard(p.rkey); }}
                                style={{ fontSize: '0.8em', padding: '0.3em 0.7em' }}
                              >
                                すてる!
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setConfirmDiscard(null)}
                                style={{ fontSize: '0.8em', padding: '0.3em 0.6em' }}
                              >
                                やめる
                              </button>
                            </span>
                          ) : (
                            <span style={{ display: 'flex', gap: '0.3em', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                disabled={!equipable || busy}
                                onClick={() => onEquip(slot, p.rkey)}
                                style={{ fontSize: '0.8em', padding: '0.3em 0.8em' }}
                              >
                                そうびする
                              </button>
                              {/* そうび中のものは捨てられない (先に はずす)。誤操作で
                                  戦闘中の装備が消えるのを構造的に防ぐ。 */}
                              <button
                                type="button"
                                className="secondary"
                                disabled={busy}
                                onClick={() => setConfirmDiscard(p.rkey)}
                                style={{ fontSize: '0.8em', padding: '0.3em 0.6em' }}
                              >
                                すてる
                              </button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
