import { useState } from 'react';
import { SKILLS, effectTarget, isPureHealSkill, skillMpCostOf, skillTargetsDownAlly, skillsForJob, type Combatant, type JobSkill } from '@aozoraquest/core';
import { ModalShell } from './world-item-modals';
import type { ServerSkillResult } from '@/lib/world-server';
import { bondUpLines } from '@/lib/bond-view';

/** フィールドの回復に出てくる 1 人 (主人公は id 'hero')。c は持ちこしの HP/MP つき。 */
export interface FieldMember { id: string; c: Combatant }

/** その人が覚えている、フィールドで使える回復のとくぎ (回復だけのとくぎ。D-PARTY-003)。 */
export function fieldHealSkills(m: FieldMember): JobSkill[] {
  return m.c.job ? skillsForJob(m.c.job.archetype, m.c.job.level).filter((k) => isPureHealSkill(k.kind)) : [];
}

/** 相手を選ぶとくぎか (全体回復・自分だけは選ばない)。 */
const picksTarget = (kind: string) => !!SKILLS[kind]?.effects.some((e) => effectTarget(e) === 'oneAlly' || effectTarget(e) === 'oneDownAlly');
const healsAll = (kind: string) => !!SKILLS[kind]?.effects.some((e) => effectTarget(e) === 'allAllies');

/** 結果の 1 文 (「〇〇は △△を となえた！ □□の HPが N かいふくした。」)。 */
export function fieldSkillMessage(r: Pick<ServerSkillResult, 'casterName' | 'skillName' | 'healed' | 'allyBondUp'> & { skillId?: string }): string {
  const revive = skillTargetsDownAlly(r.skillId ?? '');
  const lines = r.healed.map((h) => (revive ? `${h.name}が いきかえった! (HP ${h.amount})` : `${h.name}の HPが ${h.amount} かいふくした。`)).join(' ');
  return [`${r.casterName}は ${r.skillName}を となえた！ ${lines}`, ...bondUpLines(r.allyBondUp)].join(' ');
}

const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em', padding: '0.4em 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.9em' };
const btn: React.CSSProperties = { fontSize: '0.82em', padding: '0.4em 1em', touchAction: 'manipulation' };
const muted = { color: 'var(--color-muted)' };
const vitals = (c: Combatant) => <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85em', ...muted }}>HP {c.hp}/{c.maxHp}　MP {c.mp}/{c.maxMp}</span>;

/**
 * メニューの「とくぎ」(D-PARTY-003)。唱える人 → とくぎ → 相手 (全体回復は選ばない) → 結果。
 * 唱えられるのは、回復のとくぎを覚えていて MP が足りる、倒れていない人だけ。確かめと MP・HP の書き込みはサーバー。
 */
export function FieldSkillModal({ members, cast, onClose }: {
  members: readonly FieldMember[];
  cast: (caster: string, skillId: string, target: string | undefined) => Promise<ServerSkillResult>;
  onClose: () => void;
}) {
  const [caster, setCaster] = useState<string | null>(null);
  const [skill, setSkill] = useState<JobSkill | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const living = members.filter((m) => m.c.hp > 0);
  const from = members.find((m) => m.id === caster);
  const casters = living.filter((m) => fieldHealSkills(m).length > 0);
  const canCast = (m: FieldMember) => fieldHealSkills(m).some((k) => m.c.mp >= skillMpCostOf(m.c, k.kind));
  const allFull = living.every((m) => m.c.hp >= m.c.maxHp);
  const anyDown = members.some((m) => m.c.hp <= 0);
  const revive = !!skill && skillTargetsDownAlly(skill.kind);

  const run = async (skillId: string, target: string | undefined) => {
    if (!from) return;
    setBusy(true);
    try {
      const r = await cast(from.id, skillId, target);
      setMsg(fieldSkillMessage({ ...r, skillId }));
    } catch (e) {
      setMsg(e instanceof Error && e.message ? e.message : 'となえられなかった…');
    } finally {
      setBusy(false);
      setSkill(null);
      setCaster(null);
    }
  };
  const chooseSkill = (k: JobSkill) => {
    if (picksTarget(k.kind)) setSkill(k);
    else void run(k.kind, undefined);
  };
  const back = (label: string, onClick: () => void) => (
    <div style={{ marginTop: '0.4em' }}><button type="button" disabled={busy} onClick={onClick} style={btn}>{label}</button></div>
  );

  let body: React.ReactNode;
  if (!from) {
    body = (
      <>
        <div style={{ fontSize: '0.75em', ...muted, margin: '0 0 2px' }}>だれが となえる？</div>
        {casters.map((m) => (
          <div key={m.id} style={row}>
            <span>{m.c.name}<br />{vitals(m.c)}</span>
            <button type="button" disabled={busy || !canCast(m)} onClick={() => { setMsg(null); setCaster(m.id); }} style={btn}>{canCast(m) ? 'えらぶ' : 'MPが たりない'}</button>
          </div>
        ))}
      </>
    );
  } else if (!skill) {
    body = (
      <>
        <div style={{ fontSize: '0.75em', ...muted, margin: '0 0 2px' }}>{from.c.name}の とくぎ (MP {from.c.mp})</div>
        {fieldHealSkills(from).map((k) => (
          <div key={k.kind} style={row}>
            <span>{k.name} <span style={{ fontSize: '0.8em', ...muted }}>MP{skillMpCostOf(from.c, k.kind)}</span><br /><span style={{ fontSize: '0.8em', ...muted }}>{skillTargetsDownAlly(k.kind) ? 'たおれた なかまを おこす' : healsAll(k.kind) ? 'みんなの HPを かいふく' : '1人の HPを かいふく'}</span></span>
            <button type="button" disabled={busy || from.c.mp < skillMpCostOf(from.c, k.kind) || (skillTargetsDownAlly(k.kind) ? !anyDown : allFull)} onClick={() => chooseSkill(k)} style={btn}>となえる</button>
          </div>
        ))}
        {back('もどる', () => setCaster(null))}
      </>
    );
  } else {
    body = (
      <>
        <div style={{ fontSize: '0.75em', ...muted, margin: '0 0 2px' }}>{revive ? 'だれを おこす？' : 'だれを かいふくする？'}</div>
        {revive ? members.filter((m) => m.c.hp <= 0).map((m) => (
          <div key={m.id} style={row}>
            <span>{m.c.name}<br /><span style={{ fontSize: '0.85em', ...muted }}>たおれている</span></span>
            <button type="button" disabled={busy} onClick={() => void run(skill.kind, m.id)} style={btn}>おこす</button>
          </div>
        )) : living.map((m) => (
          <div key={m.id} style={row}>
            <span>{m.c.name}<br />{vitals(m.c)}</span>
            <button type="button" disabled={busy || m.c.hp >= m.c.maxHp} onClick={() => void run(skill.kind, m.id)} style={btn}>{m.c.hp >= m.c.maxHp ? 'まんたん' : 'かいふく'}</button>
          </div>
        ))}
        {back('もどる', () => setSkill(null))}
      </>
    );
  }
  return (
    <ModalShell title="とくぎ" onClose={onClose}>
      {body}
      <p aria-live="polite" style={{ fontSize: '0.82em', minHeight: '1.4em', margin: '0.4em 0 0', color: 'var(--color-fg)' }}>{msg}</p>
    </ModalShell>
  );
}
