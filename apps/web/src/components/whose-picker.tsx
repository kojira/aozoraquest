/** 「だれの？」の中身 (主人公＋仲間。D-PARTY-004)。who は主人公なら 'hero'、仲間は id。 */
export interface Whose {
  options: ReadonlyArray<{ who: string; name: string }>;
  current: string;
  onChange: (who: string) => void;
}

/** そうび・つよさ の上に出す「だれの？」の切りかえ。選べる人が 1 人だけなら出さない。 */
export function WhosePicker({ whose }: { whose: Whose | undefined }) {
  if (!whose || whose.options.length <= 1) return null;
  return (
    <div role="radiogroup" aria-label="だれの？" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, margin: '0 0 0.5em', fontSize: '0.8em' }}>
      <span style={{ color: 'var(--color-muted)' }}>だれの？</span>
      {whose.options.map((o) => (
        <button key={o.who} type="button" role="radio" aria-checked={o.who === whose.current} onClick={() => whose.onChange(o.who)}
          className={o.who === whose.current ? undefined : 'secondary'} style={{ fontSize: '1em', padding: '0.3em 0.7em', touchAction: 'manipulation' }}>
          {o.who === whose.current ? `▸ ${o.name}` : o.name}
        </button>
      ))}
    </div>
  );
}
