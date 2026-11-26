import { useState } from 'react';
import { ITEMS, itemHealAmount, itemTargetsDownAlly, withCharacterNames } from '@aozoraquest/core';
import type { FieldMember } from './field-skill-modal';

/** フィールドで使える 回復のどうぐ (決まった量・1 人) と 生き返らせるどうぐ (D-REVIVE-001)。やくそうは別の行。 */
export function fieldHealItems(materials: Readonly<Record<string, number>>): Array<{ id: string; name: string; count: number; revive: boolean }> {
  return Object.entries(materials)
    .filter(([id, n]) => n > 0 && id !== 'herb' && (itemTargetsDownAlly(id) || (itemHealAmount(id) > 0 && !ITEMS[id]?.battle?.effects.some((e) => e.kind === 'heal' && e.target === 'allAllies'))))
    .map(([id, n]) => ({ id, name: withCharacterNames(ITEMS[id]!.name), count: n, revive: itemTargetsDownAlly(id) }));
}

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5em', padding: '0.4em 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.9em' };
const btn: React.CSSProperties = { fontSize: '0.82em', padding: '0.4em 1em', touchAction: 'manipulation' };
const muted = { color: 'var(--color-muted)' };

/**
 * どうぐ の窓の、回復・生き返らせるどうぐの行と相手えらび。生き返らせるどうぐは倒れた仲間だけ、回復のどうぐは生きている人だけを並べる。
 * 確かめと書き込みはサーバー (use は結果の 1 文を返す)。
 */
export function FieldHealItemRows({ materials, members, use, onMessage }: {
  materials: Readonly<Record<string, number>>;
  members: readonly FieldMember[];
  use: (itemId: string, target: FieldMember) => Promise<string>;
  onMessage: (m: string) => void;
}) {
  const [choosing, setChoosing] = useState<{ id: string; name: string; revive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const items = fieldHealItems(materials);
  if (choosing) {
    const list = members.filter((m) => (choosing.revive ? m.c.hp <= 0 : m.c.hp > 0));
    return (
      <div data-field-heal-pick>
        <div style={{ fontSize: '0.75em', ...muted, margin: '0 0 2px' }}>{choosing.name}を だれに つかう？</div>
        {list.length === 0 && <p style={{ fontSize: '0.82em', ...muted }}>{choosing.revive ? 'たおれている なかまは いない' : 'つかえる あいてが いない'}</p>}
        {list.map((m) => (
          <div key={m.id} style={{ ...rowStyle, opacity: m.c.hp <= 0 && !choosing.revive ? 0.5 : 1 }}>
            <span>{m.c.name}<br /><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.85em', ...muted }}>HP {m.c.hp}/{m.c.maxHp}{m.c.hp <= 0 ? '　たおれている' : ''}</span></span>
            <button type="button" disabled={busy || (!choosing.revive && m.c.hp >= m.c.maxHp)} style={btn}
              onClick={async () => { setBusy(true); onMessage(await use(choosing.id, m)); setBusy(false); setChoosing(null); }}>
              {!choosing.revive && m.c.hp >= m.c.maxHp ? 'まんたん' : 'つかう'}
            </button>
          </div>
        ))}
        <div style={{ marginTop: '0.4em' }}><button type="button" onClick={() => setChoosing(null)} style={btn}>もどる</button></div>
      </div>
    );
  }
  return (
    <>
      {items.map((it) => (
        <div key={it.id} style={rowStyle}>
          <span>{it.name} <span style={muted}>×{it.count}</span><br /><span style={{ fontSize: '0.78em', ...muted }}>{it.revive ? 'たおれた なかまを おこす' : `HPを やく${itemHealAmount(it.id)} 回復`}</span></span>
          <button type="button" disabled={busy || (it.revive && !members.some((m) => m.c.hp <= 0))} onClick={() => setChoosing(it)} style={btn}>つかう</button>
        </div>
      ))}
    </>
  );
}
