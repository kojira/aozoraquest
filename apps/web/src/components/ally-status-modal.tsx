import { useEffect, useRef } from 'react';
import { jobDisplayName, jobXpToNextLevel, partyCombatants, skillsForJob, type Archetype, type RecruitStar } from '@aozoraquest/core';
import { HeroRow, Section, STAT_ROWS, StatRow } from './status-modal';
import { bondDetailText, heartsText } from '@/lib/bond-view';

/** つよさの窓に出す仲間 (パーティの仲間か、ギルドの候補)。xp は仲間が自分の経験値を持つときだけ (D-PARTY-002 §11)。 */
export interface AllyStatusTarget {
  id: string;
  name: string;
  archetype: Archetype;
  star?: RecruitStar | undefined;
  level: number;
  xp?: number | undefined;
  /** パーティの仲間の きずな (D-PARTY-004)。ギルドの候補には無い。 */
  bond?: number | undefined;
}

/**
 * 仲間の「つよさ」。主人公の StatusModal と同じつくりで、値は戦闘と同じ partyCombatants (仲間の Lv・自動の防具込み)。
 * パーティやギルドの窓の上に重ねて開くので、Escape は先に (capture で) 受けてこの窓だけを閉じ、窓は不透明 (下の一覧を透かさない)。
 */
export function AllyStatusModal({ ally, hp, mp, onClose }: { ally: AllyStatusTarget; hp?: number | undefined; mp?: number | undefined; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const c = partyCombatants([{ id: ally.id, name: ally.name, archetype: ally.archetype, level: ally.level }], ally.level)[0]!;
  const skills = skillsForJob(ally.archetype, ally.level);
  const next = ally.xp === undefined ? null : jobXpToNextLevel(ally.xp, ally.archetype);
  const job = jobDisplayName(ally.archetype);
  const stars = Math.max(1, Math.min(3, ally.star ?? 1));
  return (
    <div role="dialog" aria-modal="true" aria-label={`${ally.name}の つよさ`} onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 310, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1em' }}>
      <div className="dq-window" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-window-solid)', padding: 10, width: 'min(94vw, 420px)', maxHeight: '86svh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <strong style={{ fontSize: '0.95em' }}>💪 つよさ</strong>
          <button ref={closeRef} type="button" onClick={onClose} style={{ fontSize: '0.8em', padding: '0.3em 0.9em' }}>とじる</button>
        </div>
        <div style={{ overflowY: 'auto' }}>
          <div style={{ fontWeight: 700 }}>
            {ally.name} <span aria-label={`★${stars}`} style={{ color: '#f5c542', fontWeight: 400 }}>{'★'.repeat(stars)}</span>
            {ally.bond !== undefined && <> <span style={{ color: '#e8667a', fontWeight: 400 }}>{heartsText(ally.bond)}</span></>}
          </div>
          {ally.bond !== undefined && <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>{bondDetailText(ally.bond)}</div>}
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
            {job} Lv <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ally.level}</span>
          </div>
          <Section>
            <HeroRow label="HP" value={hp ?? c.maxHp} max={c.maxHp} bonus={0} color="#5fc37e" />
            <HeroRow label="MP" value={mp ?? c.maxMp} max={c.maxMp} bonus={0} color="#5a9ae8" />
          </Section>
          <Section title="せんとうのうりょく">
            {STAT_ROWS.map(({ key, label }) => <StatRow key={key} label={label} value={c[key]} />)}
          </Section>
          <Section title="とくぎ">
            <div style={{ lineHeight: 1.8 }}>{skills.map((s) => s.name).join('、')}</div>
          </Section>
          {next && (
            <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.6em 0 0', lineHeight: 1.7 }}>
              <div>けいけんち<span style={{ fontFamily: 'ui-monospace, monospace' }}>{ally.xp!.toLocaleString()}</span></div>
              <div>{next.next > 0 ? <>Lv {next.level + 1}まで あと<span style={{ fontFamily: 'ui-monospace, monospace' }}>{Math.max(0, next.next - next.current)}</span></> : <>Lvは 最大に達した!</>}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 一覧の名前 (押すと つよさを開く)。見た目は今の太字の名前のまま。 */
export function AllyNameButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button type="button" className="secondary" aria-label={`${name}の つよさ`} onClick={onOpen}
      style={{ border: 'none', boxShadow: 'none', padding: 0, fontWeight: 700, fontSize: '1em', textDecoration: 'underline dotted', textUnderlineOffset: '0.2em', touchAction: 'manipulation' }}>
      {name}
    </button>
  );
}
