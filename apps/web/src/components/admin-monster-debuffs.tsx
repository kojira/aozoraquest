/**
 * 管理画面のモンスター: debuffer の技 (弱体・自分への強化) を編集する (D-PARTY-002 §12a)。最大 2 つ。
 * 値の検証は core の setMonsterOverrides (保存時) が持つ。ここは入力だけ。
 */
import { STATUS_REGISTRY, type MonsterDebuff, type StatusId } from '@aozoraquest/core';

/** 敵が使える状態 (味方への弱体と、自分への強化)。 */
const DEBUFF_STATUSES: readonly StatusId[] = ['poison', 'sleep', 'stun', 'atkDown', 'defDown', 'agiDown', 'accDown', 'atkUp', 'defUp', 'thorns', 'magicReflect'];
const TARGET_LABELS = { one: '味方 1 人', all: '味方全員', self: '自分' } as const;
const MAX = 2;
const blank: MonsterDebuff = { name: '', status: 'atkDown', chance: 0.8, turns: 3 };

export function AdminMonsterDebuffs({ value, onChange }: { value: readonly MonsterDebuff[] | undefined; onChange: (next: MonsterDebuff[] | undefined) => void }) {
  const list = [...(value ?? [])];
  const set = (i: number, patch: { [K in keyof MonsterDebuff]?: MonsterDebuff[K] | undefined }) => {
    const next = list.map((d, j) => {
      if (j !== i) return d;
      const merged = { ...d, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete merged[k];
      return merged as unknown as MonsterDebuff;
    });
    onChange(next);
  };
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
      {list.map((d, i) => (
        <span key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em', alignItems: 'center' }}>
          <input aria-label="技名" placeholder="技名" value={d.name} onChange={(e) => set(i, { name: e.target.value })} style={{ width: '8em' }} />
          <select aria-label="状態" value={d.status} onChange={(e) => set(i, { status: e.target.value as StatusId })}>
            {DEBUFF_STATUSES.map((id) => <option key={id} value={id}>{STATUS_REGISTRY[id].name}</option>)}
          </select>
          <select aria-label="対象" value={d.target ?? 'one'} onChange={(e) => set(i, { target: e.target.value === 'one' ? undefined : (e.target.value as 'all' | 'self') })}>
            {(Object.keys(TARGET_LABELS) as (keyof typeof TARGET_LABELS)[]).map((k) => <option key={k} value={k}>{TARGET_LABELS[k]}</option>)}
          </select>
          <label style={{ fontSize: '0.85em' }}>確率 <input type="number" step="0.05" min="0" max="1" value={d.chance} onChange={(e) => set(i, { chance: Number(e.target.value) })} style={{ width: '4em' }} /></label>
          <label style={{ fontSize: '0.85em' }}>ターン <input type="number" min="1" max="5" value={d.turns} onChange={(e) => set(i, { turns: Number(e.target.value) })} style={{ width: '3.5em' }} /></label>
          <label style={{ fontSize: '0.85em' }}>強さ <input type="number" step="0.05" value={d.magnitude ?? ''} placeholder="既定" onChange={(e) => set(i, { magnitude: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ width: '4em' }} /></label>
          <button type="button" onClick={() => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : undefined); }}>けす</button>
        </span>
      ))}
      {list.length < MAX && <button type="button" onClick={() => onChange([...list, { ...blank }])} style={{ alignSelf: 'flex-start' }}>技を足す</button>}
      <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>上から順に、まだ付いていない状態の技を使う。全体は MP が 2 倍</span>
    </span>
  );
}
