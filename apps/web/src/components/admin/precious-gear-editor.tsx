/**
 * 管理画面の 貴重な装備 の欄 (D-RARE-GEAR-001)。装備 (貴重・効かない状態・パッシブ)、
 * モンスター (まれなドロップ)、クエスト (報酬の装備・選べる品)。検査は core (保存のとき preciousIssue)。
 */
import { GEAR_PASSIVES, STATUS_REGISTRY, activeEquipment, type EquipmentDef, type GameQuestDef, type MonsterDef, type StatusId } from '@aozoraquest/core';

const RESISTABLE: readonly StatusId[] = ['poison', 'sleep', 'stun', 'tumble', 'restraint', 'atkDown', 'defDown', 'agiDown', 'accDown', 'doomMark'];
const muted = { fontSize: '0.85em', color: 'var(--color-muted)' } as const;
const preciousGear = () => activeEquipment().filter((e) => e.precious);

/** 装備: 貴重・効かない状態・パッシブ。 */
export function PreciousGearFields({ value, onChange }: { value: EquipmentDef; onChange: (patch: { [K in keyof EquipmentDef]?: EquipmentDef[K] | undefined }) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2em', fontSize: '0.85em' }}>
      <label>
        <input type="checkbox" checked={!!value.precious} onChange={(e) => onChange({ precious: e.target.checked || undefined, ...(e.target.checked ? { price: { power: 0, materials: 0 } } : {}) })} />
        貴重 <span style={muted}>(店・バザーに出ない。値札 0。ドロップ・本編・宝箱・選ぶ報酬で渡す)</span>
      </label>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2em 0.8em' }}>
        <span style={muted}>効かない状態</span>
        {RESISTABLE.map((id) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={(value.statusResist ?? []).includes(id)}
              onChange={(e) => {
                const next = (value.statusResist ?? []).filter((x) => x !== id);
                if (e.target.checked) next.push(id);
                onChange({ statusResist: next.length ? next : undefined });
              }}
            />
            {STATUS_REGISTRY[id].name}
          </label>
        ))}
      </span>
      <label>
        <span style={muted}>パッシブ </span>
        <select value={value.passive ?? ''} onChange={(e) => onChange({ passive: e.target.value || undefined })}>
          <option value="">なし</option>
          {Object.values(GEAR_PASSIVES).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    </div>
  );
}

/** モンスター: まれなドロップ (貴重な装備・1000 分のいくつ)。 */
export function MonsterGearDropField({ value, onChange }: { value: MonsterDef; onChange: (patch: { [K in keyof MonsterDef]?: MonsterDef[K] | undefined }) => void }) {
  const g = value.gearDrop;
  return (
    <div style={{ display: 'flex', gap: '0.3em', alignItems: 'center', fontSize: '0.8em' }}>
      <span style={{ color: 'var(--color-muted)' }}>まれなドロップ</span>
      <select value={g?.equipment ?? ''} onChange={(e) => onChange({ gearDrop: e.target.value ? { equipment: e.target.value, permille: g?.permille ?? 20 } : undefined })}>
        <option value="">なし</option>
        {preciousGear().map((e) => <option key={e.id} value={e.id}>{e.name} g{e.grade}</option>)}
      </select>
      {g && (
        <>
          <input type="number" min={1} max={1000} step={1} value={g.permille} onChange={(e) => onChange({ gearDrop: { ...g, permille: Math.round(Number(e.target.value)) } })} style={{ width: '4.5em' }} />
          <span style={muted}>‰ (運・巫女の直感で少し上がる)</span>
        </>
      )}
    </div>
  );
}

/** クエスト: 報酬の装備 1 品、または選べる品 (2〜6)。 */
export function QuestGearRewardField({ value, onChange }: { value: GameQuestDef; onChange: (reward: GameQuestDef['reward']) => void }) {
  const r = value.reward ?? {};
  const set = (patch: { [K in keyof NonNullable<GameQuestDef['reward']>]?: NonNullable<GameQuestDef['reward']>[K] | undefined }) => {
    const next: Record<string, unknown> = { ...r, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    onChange(Object.keys(next).length ? (next as NonNullable<GameQuestDef['reward']>) : undefined);
  };
  const choices = r.choices ?? [];
  const all = activeEquipment().filter((e) => !e.casinoOnly);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2em' }}>
      <span>
        装備
        <select value={r.equipment ?? ''} onChange={(e) => set({ equipment: e.target.value || undefined, ...(e.target.value ? { choices: undefined } : {}) })}>
          <option value="">なし</option>
          {all.map((e) => <option key={e.id} value={e.id}>{e.name} g{e.grade}{e.precious ? ' (貴重)' : ''}</option>)}
        </select>
      </span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3em', alignItems: 'center' }}>
        選べる品
        {choices.map((id, i) => (
          <span key={i}>
            <select value={id} onChange={(e) => set({ choices: choices.map((x, j) => (j === i ? e.target.value : x)) })}>
              {all.map((e) => <option key={e.id} value={e.id}>{e.name} g{e.grade}</option>)}
            </select>
            <button type="button" onClick={() => set({ choices: choices.filter((_, j) => j !== i).length ? choices.filter((_, j) => j !== i) : undefined })}>×</button>
          </span>
        ))}
        {choices.length < 6 && <button type="button" onClick={() => set({ choices: [...choices, preciousGear()[0]?.id ?? all[0]!.id], equipment: undefined })}>＋</button>}
        <span style={muted}>(主人公と仲間が装備できる品だけ出る。16 職のどれもが 1 品は装備できる組にする)</span>
      </span>
    </span>
  );
}
