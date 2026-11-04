import { useState } from 'react';
import { bondHearts, type AllyMode } from '@aozoraquest/core';

/** さくせん の名前 (D-PARTY-004 §1)。 */
export const TACTIC_LABELS: Record<AllyMode | 'auto', string> = {
  auto: 'おまかせ', gangan: 'ガンガンいこうぜ', inochi: 'いのちだいじに', jumon: 'じゅもんせつやく', manual: 'めいれいさせろ',
};

/** その きずな で選べるもの (♥2 で さくせん、♥3 で めいれい)。段階が足りない選択肢は出さない。 */
export function tacticChoices(bond: number | undefined): Array<AllyMode | 'auto'> {
  const h = bondHearts(bond);
  if (h < 2) return [];
  return ['auto', 'gangan', 'inochi', 'jumon', ...(h >= 3 ? ['manual' as const] : [])];
}

/** つよさの窓の「さくせん」の切りかえ (♥2 から)。onChange は サーバーへ送って party を返す。 */
export function AllyTacticSelect({ bond, mode, onChange }: { bond: number | undefined; mode: AllyMode | undefined; onChange: (mode: AllyMode | null) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cur, setCur] = useState<AllyMode | 'auto'>(mode ?? 'auto');
  const choices = tacticChoices(bond);
  if (!choices.length) return null;
  const pick = async (m: AllyMode | 'auto') => {
    setBusy(true);
    setErr(null);
    try {
      await onChange(m === 'auto' ? null : m);
      setCur(m);
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : 'かえられなかった…');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="radiogroup" aria-label="さくせん" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
      {choices.map((m) => (
        <button key={m} type="button" role="radio" aria-checked={cur === m} disabled={busy} onClick={() => void pick(m)}
          className={cur === m ? undefined : 'secondary'} style={{ fontSize: '0.8em', padding: '0.45em 0.3em', touchAction: 'manipulation' }}>
          {cur === m ? `▸ ${TACTIC_LABELS[m]}` : TACTIC_LABELS[m]}
        </button>
      ))}
      {err && <div style={{ gridColumn: '1 / -1', fontSize: '0.75em', color: 'var(--color-danger, #ff6b6b)' }}>{err}</div>}
    </div>
  );
}
