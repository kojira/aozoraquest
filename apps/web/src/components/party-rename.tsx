/**
 * なまえのふだ (D-CASINO-001): パーティの画面で仲間 1 人の名前を変える。決まりはサーバーと同じ core の allyNameIssue。
 * ふだを持っているときだけ「なまえ」を出す。ふだは名前を変えられたときだけ 1 枚へる (サーバーが数える)。
 */
import { useState } from 'react';
import { ALLY_NAME_MAX, allyNameIssue, type PartyAlly } from '@aozoraquest/core';
import { TextField } from './text-field';

export interface PartyRenameProps {
  /** 持っている なまえのふだ の数。 */
  tags: number;
  /** 名前を変える (サーバーへ送る)。断られたらサーバーのことばで throw。 */
  save: (id: string, name: string) => Promise<void>;
}

const BTN = { minHeight: 44, padding: '0.3em 0.8em', fontSize: '0.85em' } as const;

export function RenameButton({ ally, rename }: { ally: PartyAlly; rename: PartyRenameProps }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(ally.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (rename.tags < 1) return null;
  if (!open) return <button type="button" style={BTN} aria-label={`${ally.name}の なまえを かえる`} onClick={() => { setName(ally.name); setError(null); setOpen(true); }}>なまえ</button>;
  const issue = allyNameIssue(name, ally.name);
  const submit = async () => {
    if (issue || busy) return;
    setBusy(true); setError(null);
    try { await rename.save(ally.id, name.trim()); setOpen(false); } catch (e) { setError(e instanceof Error ? e.message : 'かえられなかった'); } finally { setBusy(false); }
  };
  return (
    <div role="group" aria-label={`${ally.name}の あたらしい なまえ`} style={{ flex: '1 0 100%', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 4 }}>
      <TextField value={name} onChange={setName} onSubmit={() => void submit()} maxLength={ALLY_NAME_MAX + 4} aria-label="あたらしい なまえ" autoFocus style={{ flex: '1 1 8em', minHeight: 44, fontSize: '1em' }} />
      <button type="button" style={BTN} disabled={!!issue || busy} onClick={() => void submit()}>きめる</button>
      <button type="button" style={BTN} disabled={busy} onClick={() => setOpen(false)}>やめる</button>
      <span style={{ flex: '1 0 100%', fontSize: '0.75em', color: error ? '#ff8a80' : 'var(--color-muted)' }}>{error ?? (issue && name.trim() !== ally.name ? issue : `なまえのふだ を 1 枚 つかう (のこり ${rename.tags})。${ALLY_NAME_MAX} 文字まで`)}</span>
    </div>
  );
}
