import { gearDeltaIfEquipped, gearDeltaParts, type Archetype, type EquipSlot, type GearPiece, type GearSelection } from '@aozoraquest/core';

/**
 * そうびする前の差 (D-GEAR-DIFF-001)。「こうげき +6 まもり -4」と属性の一言を 1 行で。
 * 数えるのは core の gearDeltaIfEquipped (戦闘と同じ式)。上がる値は太字＋明るい色、下がる値は細字＋赤で、
 * 白黒でも符号と太さで読める。何も変わらなければ「かわらない」。
 */
export function GearDeltaText({ archetype, gear, slot, piece, battleGear, prefix }: {
  archetype: Archetype;
  gear: GearSelection;
  slot: EquipSlot;
  piece: GearPiece;
  battleGear?: ((g: GearSelection) => GearSelection) | undefined;
  prefix?: string;
}) {
  const { stats, notes } = gearDeltaParts(gearDeltaIfEquipped(archetype, gear, slot, piece, battleGear));
  return (
    <span data-testid="gear-delta" style={{ display: 'block', fontSize: '0.85em' }}>
      {prefix && <span style={{ color: 'var(--color-muted)', marginRight: '0.4em' }}>{prefix}</span>}
      {stats.length === 0 && notes.length === 0 && <span style={{ color: 'var(--color-muted)' }}>かわらない</span>}
      {stats.map((s) => (
        <span
          key={s.text}
          style={{ marginRight: '0.5em', whiteSpace: 'nowrap', fontWeight: s.up ? 700 : 400, color: s.up ? 'var(--color-accent)' : 'var(--color-danger)' }}
        >
          {s.text}
        </span>
      ))}
      {notes.map((n) => (
        <span key={n} style={{ marginRight: '0.5em', whiteSpace: 'nowrap', color: 'var(--color-muted)' }}>{n}</span>
      ))}
    </span>
  );
}
