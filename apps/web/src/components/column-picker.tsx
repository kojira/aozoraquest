/**
 * workspace のカラム追加 UI (docs/16-multicolumn.md)。
 *
 * kind を選び、必要な kind (search / profile) は param を入力して追加する。
 * board の inner 構成は従来ページ (/board) で編集したものが read-time で
 * 反映されるため、ここでは board は無パラメータで追加する。
 */
import { useState } from 'react';
import { makeAppColumn, type AppColumn, type AppColumnKind } from '@/lib/app-columns';

interface PickerDef {
  kind: AppColumnKind;
  label: string;
  needsParam?: 'search' | 'profile';
  signedInOnly?: boolean;
}

const PICKERS: PickerDef[] = [
  { kind: 'home', label: 'ホーム TL', signedInOnly: true },
  { kind: 'bar', label: 'BAR ブルスコ', signedInOnly: true },
  { kind: 'notifications', label: '通知', signedInOnly: true },
  { kind: 'board', label: 'クエスト掲示板' },
  { kind: 'search', label: '検索', needsParam: 'search' },
  { kind: 'profile', label: 'プロフィール', needsParam: 'profile' },
];

export function ColumnPicker({
  signedIn,
  onAdd,
  onClose,
}: {
  signedIn: boolean;
  onAdd: (col: AppColumn) => void;
  onClose: () => void;
}) {
  const [paramFor, setParamFor] = useState<'search' | 'profile' | null>(null);
  const [val, setVal] = useState('');

  function add(def: PickerDef) {
    if (def.needsParam) {
      setParamFor(def.needsParam);
      setVal('');
      return;
    }
    onAdd(makeAppColumn(def.kind));
  }

  function commitParam() {
    const v = val.trim();
    if (!paramFor) return;
    if (paramFor === 'search') {
      // 空でも追加可 (カラム内で検索すればよい)
      onAdd(v ? makeAppColumn('search', { param: v }) : makeAppColumn('search'));
    } else {
      // profile はハンドル必須
      if (!v) return;
      onAdd(makeAppColumn('profile', { param: v.replace(/^@/, '') }));
    }
    setParamFor(null);
    setVal('');
  }

  return (
    <div style={{ padding: '0.2em 0' }}>
      <div style={{ fontSize: '0.85em', fontWeight: 700, marginBottom: '0.5em' }}>カラムを追加</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
        {PICKERS.map((def) => {
          const locked = def.signedInOnly && !signedIn;
          return (
            <button
              key={def.kind}
              type="button"
              onClick={() => add(def)}
              disabled={locked || (paramFor !== null && def.needsParam !== paramFor)}
              title={locked ? 'サインインすると追加できます' : undefined}
              style={{ textAlign: 'left', fontSize: '0.85em', opacity: locked ? 0.5 : 1 }}
            >
              ＋ {def.label}{locked ? ' (要サインイン)' : ''}
            </button>
          );
        })}
      </div>
      {paramFor && (
        <div style={{ marginTop: '0.5em' }}>
          <label htmlFor="column-picker-param" style={{ display: 'block', fontSize: '0.78em', color: 'var(--color-muted)', marginBottom: '0.2em' }}>
            {paramFor === 'search' ? '検索キーワード (空でも OK)' : 'ハンドル (例: kojira.example)'}
          </label>
          <div style={{ display: 'flex', gap: '0.3em' }}>
            <input
              id="column-picker-param"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitParam(); } }}
              autoFocus
              style={{ flex: 1, fontSize: '0.85em' }}
            />
            <button type="button" onClick={commitParam} style={{ fontSize: '0.8em' }}>追加</button>
          </div>
        </div>
      )}
      <div style={{ marginTop: '0.7em' }}>
        <button type="button" className="secondary" onClick={onClose} style={{ fontSize: '0.8em' }}>閉じる</button>
      </div>
    </div>
  );
}
