import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';
import { useAdminSession } from '@/lib/session';
import { ADMIN_COL } from '@/lib/collections';

interface Entry {
  did: string;
  addedAt: string;
  note?: string;
}

interface DirectoryRecord {
  users: Entry[];
  updatedAt: string;
}

const OPTIN_TAG = 'aozoraquest';

export function DirectoryRoute() {
  const session = useAdminSession();
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<DirectoryRecord>(
    ADMIN_COL.directory,
    'self',
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  const [didInput, setDidInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

  // ─── 検索更新 state ───
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshErr, setRefreshErr] = useState<string | null>(null);
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);

  useEffect(() => {
    if (value?.users) setEntries(value.users);
  }, [value]);

  const add = () => {
    const d = didInput.trim();
    if (!d.startsWith('did:') || entries.some((e) => e.did === d)) return;
    const note = noteInput.trim();
    const entry: Entry = { did: d, addedAt: new Date().toISOString() };
    if (note) entry.note = note;
    setEntries([...entries, entry]);
    setDidInput('');
    setNoteInput('');
  };

  const remove = (d: string) => setEntries(entries.filter((e) => e.did !== d));

  const onSave = () => {
    void save({ users: entries, updatedAt: new Date().toISOString() } satisfies DirectoryRecord);
  };

  async function refreshFromSearch() {
    if (session.status !== 'signed-in' || !session.agent) return;
    const agent = session.agent;
    setRefreshBusy(true);
    setRefreshErr(null);
    setRefreshSummary(null);
    try {
      const seenDids = new Set(entries.map((e) => e.did));
      const newEntries: Entry[] = [...entries];
      let cursor: string | undefined;
      let totalHits = 0;
      let added = 0;
      // 最大 5 ページ、500 件まで走査する (オプトイン規模の上限目安)
      for (let page = 0; page < 5; page++) {
        const res = await agent.app.bsky.feed.searchPosts({
          q: `#${OPTIN_TAG}`,
          limit: 100,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        totalHits += res.data.posts.length;
        for (const post of res.data.posts) {
          const did = post.author?.did;
          if (!did || seenDids.has(did)) continue;
          seenDids.add(did);
          newEntries.push({ did, addedAt: new Date().toISOString(), note: 'auto' });
          added++;
        }
        const next = res.data.cursor;
        if (!next || next === cursor) break;
        cursor = next;
      }
      setEntries(newEntries);
      setRefreshSummary(`検索 ${totalHits} 件ヒット、新規 ${added} 人を追加。保存ボタンで PDS に反映。`);
    } catch (e) {
      setRefreshErr(String((e as Error)?.message ?? e));
    } finally {
      setRefreshBusy(false);
    }
  }

  return (
    <div>
      <h2>発見ディレクトリ ({entries.length} 人)</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        共鳴タイムラインの発見元。ユーザーが <code>#{OPTIN_TAG}</code> 付きで投稿することでオプトインする。
        「検索から更新」でその投稿を収集し、DID を自動追加する。
      </p>
      {!loaded && <p>読み込み中...</p>}

      <div className="section">
        <button onClick={refreshFromSearch} disabled={refreshBusy || session.status !== 'signed-in'}>
          {refreshBusy ? '検索中...' : '検索から更新 (#aozoraquest を走査)'}
        </button>
        {refreshSummary && <span style={{ marginLeft: '0.5em', color: 'var(--color-muted)', fontSize: '0.85em' }}>{refreshSummary}</span>}
        {refreshErr && <p style={{ color: '#b00', fontSize: '0.85em', marginTop: '0.5em' }}>{refreshErr}</p>}
      </div>

      <div className="section">
        <input
          value={didInput}
          onChange={(e) => setDidInput(e.target.value)}
          placeholder="did:plc:..."
          style={{ padding: '0.4em', width: '50%' }}
        />
        <input
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          placeholder="メモ (任意)"
          style={{ padding: '0.4em', marginLeft: '0.5em', width: '25%' }}
        />
        <button onClick={add} style={{ marginLeft: '0.5em' }}>手動追加</button>
      </div>

      <div className="section">
        {entries.length === 0 ? (
          <p style={{ color: 'var(--color-muted)' }}>まだ誰も登録されていません。「検索から更新」で取得できます。</p>
        ) : (
          <table style={{ width: '100%', fontSize: '0.9em' }}>
            <thead>
              <tr><th style={{ textAlign: 'left' }}>DID</th><th>追加</th><th>メモ</th><th>操作</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.did}>
                  <td><code>{e.did}</code></td>
                  <td style={{ color: 'var(--color-muted)' }}>{new Date(e.addedAt).toLocaleDateString()}</td>
                  <td>{e.note ?? ''}</td>
                  <td><button className="secondary" onClick={() => remove(e.did)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving}>{saving ? '保存中...' : '保存 (PDS に書き込み)'}</button>
        {savedMark && <span style={{ color: '#1a6230', fontSize: '0.85em' }}>✓ 保存</span>}
        {err && <span style={{ color: '#b00', fontSize: '0.85em' }}>エラー: {err}</span>}
      </div>
    </div>
  );
}
