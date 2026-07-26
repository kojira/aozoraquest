import { useEffect, useMemo, useRef } from 'react';
import {
  EQUIPMENT_BY_ID,
  skillKindLabel,
  skillsForJob,
  jobDisplayName,
  jobXpToNextLevel,
  leveledName,
  mpGainsFor,
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
  jobXp,
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
  jobXp: number;
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

  // キット持ちジョブ (#456) では署名スキル [0] が実技と一致しないため、現在の習得済みとくぎ列を出す。
  const skills = useMemo(() => skillsForJob(archetype, jobLv), [archetype, jobLv]);
  const mpTrait = useMemo(() => mpGainsFor(archetype), [archetype]);
  const jobNext = useMemo(() => jobXpToNextLevel(jobXp, archetype), [jobXp, archetype]);

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
                {jobDisplayName(archetype, 'default')} Lv <span style={num}>{jobLv}</span>
              </div>
            </div>
          </div>

          {/* HP/MP — 主役なので大きめ・太字で立てる (レビュー ★)。装備で最大値が
              上がる防具/お守りがあるので、5 ステと同じく「そうび +N」内訳を出す */}
          <Section>
            <HeroRow label="HP" value={hp ?? combat.maxHp} max={combat.maxHp} bonus={combat.maxHp - combatBase.maxHp} color="#5fc37e" />
            {/* たいりょく (#518) は HP の元。せんとうのうりょくに並べると HP と離れて
                「何の数字か」が伝わらないので、HP の直下に小さく添える (行を増やさず
                派生関係だけ見せる)。**装備の maxHp ボーナスは vit を経由せず HP に直接
                加算される**ので、装備時は HP ≠ 6 + たいりょく × 2 になる (HP 行の
                「そうび +N」がその差分)。関係を画面に出すかは #526。 */}
            <div style={{ textAlign: 'right', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '-0.2em', marginBottom: '0.7em' }}>
              たいりょく <span style={num}>{combat.vit}</span>
            </div>
            <HeroRow label="MP" value={mp ?? combat.maxMp} max={combat.maxMp} bonus={combat.maxMp - combatBase.maxMp} color="#5a9ae8" />
          </Section>

          {/* 戦闘ステータス */}
          <Section title="せんとうのうりょく">
            {STAT_ROWS.map(({ key, label }) => {
              const bonus = combat[key] - combatBase[key];
              return (
                <StatRow
                  key={key}
                  label={label}
                  value={combat[key]}
                  note={bonus !== 0 ? `そうび ${bonus > 0 ? '+' : ''}${bonus}` : undefined}
                />
              );
            })}
          </Section>

          {/* とくぎ / とくせい */}
          <Section title="とくぎ・とくせい">
            <div style={{ lineHeight: 1.8 }}>
              <div>
                とくぎ: <strong>{skills.map((s) => s.name).join('、')}</strong>{' '}
                {skills.length === 1 && skillKindLabel(skills[0]!.kind) ? (
                  <span style={{ color: 'var(--color-muted)' }}>({skillKindLabel(skills[0]!.kind)})</span>
                ) : null}
              </div>
              {mpTrait.traitName ? (
                <div>
                  とくせい: <strong>{mpTrait.traitName}</strong>{' '}
                  <span style={{ color: 'var(--color-muted)' }}>
                    (たたかう MP +{mpTrait.attackGain} / ぼうぎょ MP +{mpTrait.guardGain})
                  </span>
                </div>
              ) : (
                <div style={{ color: 'var(--color-muted)' }}>とくせい: なし</div>
              )}
            </div>
          </Section>

          {/* そうび */}
          <Section title="そうび">
            <div style={{ lineHeight: 1.8 }}>
              {(['weapon', 'armor', 'charm'] as const).map((slot) => {
                const piece = gearPieces[slot];
                const def = piece ? EQUIPMENT_BY_ID[piece.itemId] : undefined;
                return (
                  <div key={slot} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
                    <span style={{ color: 'var(--color-muted)' }}>{SLOT_LABELS[slot]}</span>
                    {piece && def ? <strong>{leveledName(def, piece.level)}</strong> : <span style={{ color: 'var(--color-muted)' }}>なし</span>}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* つぎのレベルまで */}
          <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.6em 0 0', lineHeight: 1.7 }}>
            <div>
              {jobNext.next > 0 ? (
                <>{jobDisplayName(archetype, 'default')} Lv {jobNext.level + 1} まで あと <span style={num}>{Math.max(0, jobNext.next - jobNext.current)}</span></>
              ) : (
                <>{jobDisplayName(archetype, 'default')} Lv はさいだいに たっした!</>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** DQ の「つよさ」らしい枠付きセクション (枠の連なりを最後まで通す — レビュー ★★) */
function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: '2px solid var(--color-border)',
        borderRadius: 4,
        padding: '0.4em 0.7em 0.5em',
        marginTop: 8,
        fontSize: '0.85em',
      }}
    >
      {title && (
        <div style={{ fontSize: '0.72em', color: 'var(--color-muted)', letterSpacing: '0.04em', marginBottom: 2 }}>{title}</div>
      )}
      {children}
    </div>
  );
}

/** HP/MP の主役行 (大きめ + バー) */
function HeroRow({ label, value, max, bonus, color }: { label: string; value: number; max: number; bonus: number; color: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{ margin: '0.15em 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: '1.05em' }}>{label}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '1.05em', whiteSpace: 'nowrap' }}>
          {value} <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>/ {max}</span>
          {bonus !== 0 && (
            <span style={{ fontFamily: 'inherit', fontSize: '0.68em', fontWeight: 400, color: 'var(--color-accent)', marginLeft: '0.5em' }}>
              (そうび {bonus > 0 ? '+' : ''}{bonus})
            </span>
          )}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--color-track-bg)', borderRadius: 3, overflow: 'hidden', marginTop: 2 }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

function StatRow({ label, value, note }: { label: string; value: number; note?: string | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em', lineHeight: 1.9 }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
        {value}
        {note && <span style={{ fontFamily: 'inherit', fontSize: '0.78em', color: 'var(--color-accent)', marginLeft: '0.5em' }}>({note})</span>}
      </span>
    </div>
  );
}
