import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';
import { ADMIN_COL } from '@/lib/collections';

interface FlagDraft {
  id: string;
  enabled: boolean;
  rollout: number;
  description: string;
}

interface FlagsRecord {
  flags: Record<string, { enabled: boolean; rollout: number; description: string }>;
  updatedAt: string;
}

const INITIAL_FLAGS: FlagDraft[] = [
  { id: 'compatibilityMap', enabled: true, rollout: 100, description: '共鳴マップ' },
  { id: 'pairTitles', enabled: false, rollout: 0, description: 'ペア称号' },
];

export function Flags() {
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<FlagsRecord>(
    ADMIN_COL.configFlags,
    'self',
  );
  const [flags, setFlags] = useState<FlagDraft[]>(INITIAL_FLAGS);

  useEffect(() => {
    if (!value) return;
    const list: FlagDraft[] = Object.entries(value.flags ?? {}).map(([id, v]) => ({
      id,
      enabled: v.enabled,
      rollout: v.rollout,
      description: v.description,
    }));
    if (list.length > 0) setFlags(list);
  }, [value]);

  const updateFlag = (id: string, patch: Partial<FlagDraft>) => {
    setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const onSave = () => {
    const record: FlagsRecord = {
      flags: Object.fromEntries(flags.map((f) => [f.id, { enabled: f.enabled, rollout: f.rollout, description: f.description }])),
      updatedAt: new Date().toISOString(),
    };
    void save(record);
  };

  return (
    <div>
      <h2>フィーチャーフラグ</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        保存すると主管理者 PDS の <code>{ADMIN_COL.configFlags}/self</code> に書き込まれ、次回起動から全ユーザーに反映されます。
      </p>
      {!loaded && <p>読み込み中...</p>}

      {flags.map((f) => (
        <div className="section" key={f.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
            <input
              type="checkbox"
              checked={f.enabled}
              onChange={(e) => updateFlag(f.id, { enabled: e.target.checked })}
            />
            <strong>{f.id}</strong>
            <span style={{ flex: 1, color: 'var(--color-muted)' }}>{f.description}</span>
          </div>
          <label style={{ display: 'block', marginTop: '0.6em' }}>
            ロールアウト: {f.rollout}%
            <input
              type="range"
              min={0}
              max={100}
              value={f.rollout}
              onChange={(e) => updateFlag(f.id, { rollout: Number(e.target.value) })}
              style={{ width: '100%' }}
            />
          </label>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving}>{saving ? '保存中...' : '保存 (PDS に書き込み)'}</button>
        {savedMark && <span style={{ color: '#1a6230', fontSize: '0.85em' }}>✓ 保存</span>}
        {err && <span style={{ color: '#b00', fontSize: '0.85em' }}>エラー: {err}</span>}
      </div>
    </div>
  );
}
