import { useMemo, type ReactNode } from 'react';
import {
  GEAR_SLOTS,
  GEAR_SLOT_LABELS,
  EQUIPMENT_BY_ID,
  skillKindLabel,
  skillsForJob,
  jobDisplayName,
  jobXpToNextLevel,
  leveledName,
  mpGainsFor,
  signed,
  type Archetype,
  type Combatant,
  type GearSelection,
} from '@aozoraquest/core';
import { Avatar } from './avatar';
import { bondDetailText, heartsText } from '@/lib/bond-view';

/**
 * つよさ画面の中身 (戦闘ステータスの可視化。issue #285)。主人公も仲間もこれ 1 つで出す (#1003)。
 *
 * DQ の「つよさ」に寄せた 1 枚窓: 名前/ジョブ/レベル → HP/MP → 戦闘ステータス
 * (装備込みの実効値 + 装備ぶんの内訳) → とくぎ/とくせい → そうび。
 * 値は戦闘に渡しているのと同じ combat (主人公は playerCombatant、仲間は partyMemberCombatant) を
 * そのまま表示する — 「つよさ画面の数字 = 戦闘の数字」を崩さない。
 */

const SLOT_LABELS = GEAR_SLOT_LABELS;

export const STAT_ROWS: readonly { key: 'atk' | 'def' | 'agi' | 'int' | 'luk'; label: string }[] = [
  { key: 'atk', label: 'こうげき' },
  { key: 'def', label: 'まもり' },
  { key: 'agi', label: 'すばやさ' },
  { key: 'int', label: 'かしこさ' },
  { key: 'luk', label: 'うん' },
];

export function StatusSheet({ name, avatarUrl, archetype, jobLv, jobXp, combat, combatBase, hp, mp, gear, trait, star, bond, tactic }: {
  /** 表示名 (主人公は Bluesky の displayName / handle、仲間は名前) */
  name: string;
  avatarUrl?: string | null | undefined;
  archetype: Archetype;
  jobLv: number;
  /** けいけんち。仲間が自分の経験値を持たないとき (§11 より前のなじみ・ギルドの候補) は出さない。 */
  jobXp?: number | undefined;
  /** 装備込みの実効値 (戦闘に渡すものと同一) */
  combat: Combatant;
  /** 装備なしの素の値 (装備ぶんの内訳表示用) */
  combatBase: Combatant;
  /** フィールドの現在 HP/MP (null = 全快) */
  hp: number | null;
  mp: number | null;
  /** 戦闘で着ている装備 (combat を作ったのと同じもの) */
  gear: GearSelection;
  /** とくせい (MP の回復) を出すか。戦闘で効くのは主人公だけ。 */
  trait: boolean;
  /** 仲間の ★ と きずな (D-PARTY-004)。 */
  star?: number | undefined;
  bond?: number | undefined;
  /** さくせん の切りかえ (仲間で ♥2 から)。 */
  tactic?: ReactNode;
}) {
  // 現在のとくぎ列 (署名スキル + 習得済みキット技) を出す。戦闘の playerSkills と同じ列。
  const skills = useMemo(() => skillsForJob(archetype, jobLv), [archetype, jobLv]);
  const mpTrait = useMemo(() => mpGainsFor(archetype), [archetype]);
  const jobNext = useMemo(() => (jobXp === undefined ? null : jobXpToNextLevel(jobXp, archetype)), [jobXp, archetype]);
  const stars = star === undefined ? null : Math.max(1, Math.min(3, star));

  const num = { fontFamily: 'ui-monospace, monospace' as const };

  return (
    <>
      {/* 名前とレベル */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6em', marginBottom: 6 }}>
        <Avatar src={avatarUrl ?? undefined} size={44} archetype={archetype} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name || 'ぼうけんしゃ'}
            {stars !== null && <> <span aria-label={`★${stars}`} style={{ color: '#f5c542', fontWeight: 400 }}>{'★'.repeat(stars)}</span></>}
            {bond !== undefined && <> <span style={{ color: '#e8667a', fontWeight: 400 }}>{heartsText(bond)}</span></>}
          </div>
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
            {jobDisplayName(archetype, 'default')} Lv <span style={num}>{jobLv}</span>
          </div>
          {bond !== undefined && <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>{bondDetailText(bond)}</div>}
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
          たいりょく<span style={num}>{combat.vit}</span>
        </div>
        <HeroRow label="MP" value={mp ?? combat.maxMp} max={combat.maxMp} bonus={combat.maxMp - combatBase.maxMp} color="#5a9ae8" />
      </Section>

      {tactic && <Section title="さくせん">{tactic}</Section>}

      {/* 戦闘ステータス */}
      <Section title="せんとうのうりょく">
        {STAT_ROWS.map(({ key, label }) => {
          const bonus = combat[key] - combatBase[key];
          return (
            <StatRow
              key={key}
              label={label}
              value={combat[key]}
              note={bonus !== 0 ? `そうび${signed(bonus)}` : undefined}
            />
          );
        })}
      </Section>

      {/* とくぎ / とくせい */}
      <Section title={trait ? 'とくぎ・とくせい' : 'とくぎ'}>
        <div style={{ lineHeight: 1.8 }}>
          <div>
            とくぎ: <strong>{skills.map((s) => s.name).join('、')}</strong>{' '}
            {skills.length === 1 && skillKindLabel(skills[0]!.kind) ? (
              <span style={{ color: 'var(--color-muted)' }}>({skillKindLabel(skills[0]!.kind)})</span>
            ) : null}
          </div>
          {!trait ? null : mpTrait.traitName ? (
            <div>
              とくせい: <strong>{mpTrait.traitName}</strong>{' '}
              <span style={{ color: 'var(--color-muted)' }}>
                {/* 確率発動の特性は「ときどき」を付ける (毎回もらえると誤読させない)。
                    確率の数値は出さないが、**うんで上がることは出す** — 装備で
                    うんを盛る動機になる情報で、知らないと選べない。 */}
                ({mpTrait.chance !== undefined ? 'ときどき (「うん」で上がる) ' : ''}
                たたかう MP+{mpTrait.attackGain} / ぼうぎょ MP+{mpTrait.guardGain})
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
          {GEAR_SLOTS.map((slot) => {
            const piece = gear[slot];
            const def = piece ? EQUIPMENT_BY_ID[typeof piece === 'string' ? piece : piece.id] : undefined;
            return (
              <div key={slot} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5em' }}>
                <span style={{ color: 'var(--color-muted)' }}>{SLOT_LABELS[slot]}</span>
                {def ? <strong>{leveledName(def, typeof piece === 'string' ? 0 : piece?.level ?? 0)}</strong> : <span style={{ color: 'var(--color-muted)' }}>なし</span>}
              </div>
            );
          })}
        </div>
      </Section>

      {/* けいけんち: **いまの累計**と、つぎのレベルまで。
          「あと N」だけだと、戦って本当に入っているのかが分からない
          (レベルが上がるまで数字が一切動かない = 入っていないのと区別できない)。 */}
      {jobNext && (
        <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.6em 0 0', lineHeight: 1.7 }}>
          <div>
            けいけんち<span style={num}>{jobXp!.toLocaleString()}</span>
          </div>
          <div>
            {jobNext.next > 0 ? (
              <>{jobDisplayName(archetype, 'default')} Lv {jobNext.level + 1}まであと<span style={num}>{Math.max(0, jobNext.next - jobNext.current)}</span></>
            ) : (
              <>{jobDisplayName(archetype, 'default')} Lvは最大に達した!</>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** DQ の「つよさ」らしい枠付きセクション (枠の連なりを最後まで通す — レビュー ★★) */
export function Section({ title, children }: { title?: string; children: React.ReactNode }) {
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
export function HeroRow({ label, value, max, bonus, color }: { label: string; value: number; max: number; bonus: number; color: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div style={{ margin: '0.15em 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, fontSize: '1.05em' }}>{label}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: '1.05em', whiteSpace: 'nowrap' }}>
          {value} <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>/ {max}</span>
          {bonus !== 0 && (
            <span style={{ fontFamily: 'inherit', fontSize: '0.68em', fontWeight: 400, color: 'var(--color-accent)', marginLeft: '0.5em' }}>
              (そうび{signed(bonus)})
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

export function StatRow({ label, value, note }: { label: string; value: number; note?: string | undefined }) {
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
