import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';
import { ADMIN_COL } from '@/lib/collections';

interface MaintRecord {
  enabled: boolean;
  message?: string;
  until?: string;
  allowedDids?: string[];
  updatedAt: string;
}

export function Maintenance() {
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<MaintRecord>(
    ADMIN_COL.configMaintenance,
    'self',
  );
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('メンテナンス中です。しばらくお待ちください。');
  const [until, setUntil] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!value) return;
    setEnabled(value.enabled ?? false);
    if (value.message !== undefined) setMessage(value.message);
    if (value.until !== undefined) setUntil(value.until);
  }, [value]);

  const canSave = !enabled || confirm === 'MAINTENANCE';

  const onSave = () => {
    const record: MaintRecord = {
      enabled,
      updatedAt: new Date().toISOString(),
    };
    if (message) record.message = message;
    if (until) record.until = until;
    void save(record);
  };

  return (
    <div>
      <h2>メンテナンスモード</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        有効化すると、次回起動時に全ユーザー (管理者除く) が一時停止画面を表示。
      </p>
      {!loaded && <p>読み込み中...</p>}

      <div className="section">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5em', fontSize: '1.05em' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          メンテナンスモードを有効化
        </label>
      </div>

      <div className="section">
        <label>
          メッセージ:
          <br />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            style={{ width: '100%', padding: '0.5em' }}
          />
        </label>
        <label style={{ marginTop: '0.5em', display: 'block' }}>
          終了予定:{' '}
          <input
            type="datetime-local"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </label>
      </div>

      {enabled && (
        <div style={{ marginBottom: '1em', padding: '0.8em', background: '#fff2f3', border: '1px solid #f5c2c7', borderRadius: 4, color: '#842029' }}>
          破壊的操作です。保存前に確認文字列を入力してください。
          <br />
          <input
            type="text"
            placeholder="MAINTENANCE と入力"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ marginTop: '0.5em', padding: '0.3em' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving || !canSave}>{saving ? '保存中...' : '保存 (PDS に書き込み)'}</button>
        {savedMark && <span style={{ color: '#1a6230', fontSize: '0.85em' }}>✓ 保存</span>}
        {err && <span style={{ color: '#b00', fontSize: '0.85em' }}>エラー: {err}</span>}
      </div>
    </div>
  );
}
