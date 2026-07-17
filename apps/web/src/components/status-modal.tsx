import { useEffect, useMemo, useRef } from 'react';
import {
  EQUIPMENT_BY_ID,
  SKILL_KIND_LABELS,
  jobDisplayName,
  jobXpToNextLevel,
  leveledName,
  mpGainsFor,
  playerXpToNextLevel,
  skillForJob,
  type Archetype,
  type Combatant,
  type EquipSlot,
} from '@aozoraquest/core';
import { Avatar } from './avatar';
import type { CraftedPiece } from '@/lib/crafting';

/**
 * つよさ画面 (オーナー要望 2026-07-18「つよさコマンドでかっこよく全ステータスを
 * 確認できるようにしたい」 — issue #285 の戦闘ステータス可視化)。
 *
 * DQ の「つよさ」に寄せた 1 枚窓: 名前/ジョブ/レベル → HP/MP → 戦闘ステータス
 * (装備込みの実効値 + 装備ぶんの内訳) → とくぎ/とくせい → そうび。
 * 値は world.tsx が戦闘に渡しているのと同じ combat (playerCombatant の結果) を
 * そのまま表示する — 「つよさ画面の数字 = 戦闘の数字」を崩さない。
 */

const SLOT_LABELS: Record<EquipSlot, string> = {
  weapon: 'ぶき',
  armor: 'よろい',
  charm: 'おまもり',
};

const STAT_ROWS: readonly { key: 'atk' | 'def' | 'agi' | 'int' | 'luk'; label: string }[] = [
  { key: 'atk', label: 'こうげき' },
  { key: 'def', label: 'まもり' },
  { key: 'agi', label: 'すばやさ' },
  { key: 'int', label: 'かしこさ' },
  { key: 'luk', label: 'うん' },
];

export function StatusModal({
  name,
  avatarUrl,
  archetype,
  jobLv,
  playerLv,
  jobXp,
  playerXp,
  combat,
  combatBase,
  hp,
  mp,
  gearPieces,
  onClose,
}: {
  /** 表示名 (Bluesky の displayName / handle) */
  name: string;
  avatarUrl: string | null;
  archetype: Archetype;
  jobLv: number;
  playerLv: number;
  jobXp: number;
  playerXp: number;
  /** 装備込みの実効値 (戦闘に渡すものと同一) */
  combat: Combatant;
  /** 装備なしの素の値 (装備ぶんの内訳表示用) */
  combatBase: Combatant;
  /** フィールドの現在 HP/MP (null = 全快) */
  hp: number | null;
  mp: number | null;
  /** スロットごとの解決済み装備 (resolveGear の結果) */
  gearPieces: Partial<Record<EquipSlot, CraftedPiece>>;
  onClose: () => void;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const skill = useMemo(() => skillForJob(archetype), [archetype]);
  const mpTrait = useMemo(() => mpGainsFor(archetype), [archetype]);
  const jobNext = useMemo(() => jobXpToNextLevel(jobXp), [jobXp]);
  const playerNext = useMemo(() => playerXpToNextLevel(playerXp), [playerXp]);

  const num = { fontFamily: 'ui-monospace, monospace' as const };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="つよさ"
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
        style={{ padding: 10, width: 'min(94vw, 420px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>💪 つよさ</strong>
          <button ref={closeBtnRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>
            とじる
          </button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          {/* 名前とレベル */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: 6 }}>
            <Avatar src={avatarUrl ?? undefined} size={44} archetype={archetype} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'ぼうけんしゃ'}</div>
              <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
                {jobDisplayName(archetype, 'default')} Lv <span style={num}>{jobLv}</span> / ぼうけん Lv <span style={num}>{playerLv}</span>
              </div>
            </div>
          </div>

          {/* HP/MP + 戦闘ステータス (DQ の 2 列風) */}
          <div
            style={{
              border: '2px solid var(--color-border)',
              borderRadius: 4,
              padding: '0.5em 0.7em',
              fontSize: '0.9em',
              lineHeight: 1.9,
            }}
          >
            <StatRow label="HP" value={`${hp ?? combat.maxHp} / ${combat.maxHp}`} />
            <StatRow label="MP" value={`${mp ?? combat.maxMp} / ${combat.maxMp}`} />
            {STAT_ROWS.map(({ key, label }) => {
              const bonus = combat[key] - combatBase[key];
              return (
                <StatRow
                  key={key}
                  label={label}
                  value={String(combat[key])}
                  note={bonus !== 0 ? `そうび ${bonus > 0 ? '+' : ''}${bonus}` : undefined}
                />
              );
            })}
          </div>

          {/* とくぎ / とくせい */}
          <div style={{ fontSize: '0.82em', margin: '0.6em 0 0', lineHeight: 1.7 }}>
            <div>
              とくぎ: <strong>{skill.name}</strong>{' '}
              <span style={{ color: 'var(--color-muted)' }}>({SKILL_KIND_LABELS[skill.kind]})</span>
            </div>
            {mpTrait.traitName && (
              <div>
                とくせい: <strong>{mpTrait.traitName}</strong>{' '}
                <span style={{ color: 'var(--color-muted)' }}>
                  (たたかう MP +{mpTrait.attackGain} / ぼうぎょ MP +{mpTrait.guardGain})
                </span>
              </div>
            )}
          </div>

          {/* そうび */}
          <div style={{ fontSize: '0.82em', margin: '0.5em 0 0', lineHeight: 1.7 }}>
            {(['weapon', 'armor', 'charm'] as const).map((slot) => {
              const piece = gearPieces[slot];
              const def = piece ? EQUIPMENT_BY_ID[piece.itemId] : undefined;
              return (
                <div key={slot}>
                  {SLOT_LABELS[slot]}: {piece && def ? <strong>{leveledName(def, piece.level)}</strong> : <span style={{ color: 'var(--color-muted)' }}>なし</span>}
                </div>
              );
            })}
          </div>

          {/* つぎのレベルまで */}
          <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.6em 0 0', lineHeight: 1.7 }}>
            <div>
              {jobNext.next > 0 ? (
                <>ジョブ Lv {jobNext.level + 1} まで あと <span style={num}>{Math.max(0, jobNext.next - jobNext.current)}</span></>
              ) : (
                <>ジョブ Lv はさいだいに たっした!</>
              )}
            </div>
            <div>
              {playerNext.next > 0 ? (
                <>ぼうけん Lv {playerNext.level + 1} まで あと <span style={num}>{Math.max(0, playerNext.next - playerNext.current)}</span></>
              ) : (
                <>ぼうけん Lv はさいだいに たっした!</>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, note }: { label: string; value: string; note?: string | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace' }}>
        {note && <span style={{ fontFamily: 'inherit', fontSize: '0.8em', color: 'var(--color-accent)', marginRight: '0.6em' }}>{note}</span>}
        {value}
      </span>
    </div>
  );
}
