import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MAX_CHARACTER_NAME, worldRefs, type CharacterDef } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadAuthoredWorld, loadCharactersRecord, saveCharacters } from '@/lib/world-authoring';
import { AuthoredWorldGate } from '@/components/admin/authored-world-gate';

/**
 * **人物の名前** (D-CHAR-001 §2-7)。文に書いた `{c:id}` の置き換え先。改名はここの 1 行を変えるだけ。
 * id は作ったあと変えられない (文の側が id で指している)。使われている人物は消せない。
 * 参照数は全レコードを読み込んでから数える (loadAuthoredWorld)。人物は厳密に読む (読めなければ保存させない)。
 */
export function AdminCharacters() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<CharacterDef[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    let cancelled = false;
    const agent = session.agent, did = getPrimaryAdminDid();
    if (!admin || !agent || !did) { setLoadState('failed'); return; }
    void loadAuthoredWorld(agent).then(() => loadCharactersRecord(agent, did)).then((chars) => {
      if (cancelled) return;
      setList(chars.map((c) => ({ ...c }))); setLoadState('ok');
    }).catch((e: unknown) => {
      if (cancelled) return;
      setLoadState('failed'); setNote(`保存済みの人物を読み込めなかった。上書きで消える恐れがあるので保存できない (${String(e)})`);
    });
    return () => { cancelled = true; };
  }, [session.agent, admin]);

  /** id → 参照元の説明 (どのレコードのどこから使われているか)。読み込み済みの全レコードから数える。 */
  const refs = new Map<string, string[]>();
  for (const r of worldRefs('character')) refs.set(r.id, [...(refs.get(r.id) ?? []), r.from]);

  const rename = (id: string, name: string) => { setList((xs) => xs.map((c) => (c.id === id ? { ...c, name } : c))); setDirty(true); };
  const add = () => {
    const id = newId.trim(), name = newName.trim();
    if (!id || !name) return;
    if (list.some((c) => c.id === id)) { setNote(`id「${id}」はもうある`); return; }
    setList((xs) => [...xs, { id, name }]); setNewId(''); setNewName(''); setDirty(true); setNote(null);
  };
  const save = async () => {
    if (!session.agent || loadState !== 'ok') return;
    try {
      await saveCharacters(session.agent, list);
      setDirty(false); setNote(`${list.length} 人を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) { setNote(`保存できない: ${e instanceof Error ? e.message : String(e)}`); }
  };

  if (!admin) return <div style={{ padding: '1em' }}><p>この画面は管理者だけが使えます。</p><Link to="/admin">管理ダッシュボードへ</Link></div>;
  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>人物の名前</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{list.length} 人</span>
        <button type="button" onClick={() => void save()} disabled={!dirty || loadState !== 'ok'} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>保存</button>
      </div>
      {note && <p role="status" style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', margin: '0 0 0.4em' }}>
        文に {'{c:id}'} と書くと、表示のときにここの名前になる。同じ文字でも意味が違えば別の id にする (鳥の homura と町の homura-town など)。
      </p>
      <AuthoredWorldGate loaded={loadState === 'ok'}>
        <table style={{ fontSize: '0.85em', borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>id</th><th style={{ textAlign: 'left' }}>名前</th><th style={{ textAlign: 'left' }}>参照</th><th /></tr></thead>
          <tbody>
            {list.map((c) => {
              const from = refs.get(c.id) ?? [];
              return (
                <tr key={c.id} aria-label={c.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td><code>{c.id}</code></td>
                  <td><input aria-label={`${c.id} の名前`} value={c.name} maxLength={MAX_CHARACTER_NAME} onChange={(e) => rename(c.id, e.target.value)} style={{ width: '9em' }} /></td>
                  <td title={from.join('\n')}>{from.length}か所{from.length > 0 && <details><summary style={{ fontSize: '0.85em' }}>どこ</summary>{from.map((f, i) => <div key={i}>{f}</div>)}</details>}</td>
                  <td><button type="button" className="secondary" aria-label={`${c.id} を消す`} disabled={from.length > 0}
                    onClick={() => { setList((xs) => xs.filter((x) => x.id !== c.id)); setDirty(true); }}>消す</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', marginTop: '0.5em', fontSize: '0.85em' }}>
          <input aria-label="新しい id" value={newId} placeholder="id (英小文字・数字・-)" onChange={(e) => setNewId(e.target.value)} style={{ width: '11em', fontFamily: 'ui-monospace, monospace' }} />
          <input aria-label="新しい名前" value={newName} placeholder="名前" maxLength={MAX_CHARACTER_NAME} onChange={(e) => setNewName(e.target.value)} style={{ width: '9em' }} />
          <button type="button" onClick={add} disabled={!newId.trim() || !newName.trim()}>＋人物</button>
        </div>
      </AuthoredWorldGate>
    </div>
  );
}
