import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';

interface BansRecord {
  dids: string[];
  updatedAt: string;
}

export function Bans() {
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<BansRecord>(
    'app.aozoraquest.config.bans',
    'self',
  );
  const [dids, setDids] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (value?.dids) setDids(value.dids);
  }, [value]);

  const add = () => {
    const d = input.trim();
    if (d && d.startsWith('did:') && !dids.includes(d)) {
      setDids([...dids, d]);
      setInput('');
    }
  };
  const remove = (d: string) => setDids(dids.filter((x) => x !== d));

  const onSave = () => {
    void save({ dids, updatedAt: new Date().toISOString() } satisfies BansRecord);
  };

  return (
    <div>
      <h2>BAN リスト</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        ここに追加した DID の投稿は全ユーザーのタイムライン / バッジ / 共鳴 TL から除外されます。
        公開されることに注意 (主管理者 PDS の公開レコード)。
      </p>
      {!loaded && <p>読み込み中...</p>}

      <div className="section">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="did:plc:..."
          style={{ padding: '0.4em', width: '60%' }}
        />
        <button onClick={add} style={{ marginLeft: '0.5em' }}>追加</button>
      </div>

      <div className="section">
        {dids.length === 0 ? (
          <p style={{ color: 'var(--color-muted)' }}>BAN されている DID はありません。</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {dids.map((d) => (
              <li key={d} style={{ padding: '0.4em 0', borderBottom: '1px solid var(--color-border)' }}>
                <code>{d}</code>{' '}
                <button className="secondary" onClick={() => remove(d)} style={{ marginLeft: '0.5em' }}>削除</button>
              </li>
            ))}
          </ul>
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
