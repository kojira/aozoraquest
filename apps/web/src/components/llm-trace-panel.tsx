import { useEffect, useState } from 'react';
import { readLlmTrace, clearLlmTrace } from '@/lib/llm-trace';

/**
 * 前回 (またはクラッシュ前) の LLM trace を表示する小パネル。
 * iOS Safari の OOM クラッシュ後に reload した時、何が起きたか可視化するため。
 *
 * trace が無ければ何も描画しない。
 */
export function LlmTracePanel() {
  const [entries, setEntries] = useState(() => readLlmTrace());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // mount 時に読み直し (initial state は SSR 用 fallback)
    setEntries(readLlmTrace());
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: '0.8em',
        padding: '0.6em 0.8em',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 6,
        background: 'rgba(0,0,0,0.4)',
        fontSize: '0.8em',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
        <strong style={{ color: '#9fd7ff' }}>前回 LLM トレース</strong>
        <span style={{ color: 'var(--color-muted)' }}>{entries.length} 件</span>
        <button
          style={{ marginLeft: 'auto', padding: '0.2em 0.6em' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '隠す' : '表示'}
        </button>
        <button
          style={{ padding: '0.2em 0.6em' }}
          onClick={() => {
            clearLlmTrace();
            setEntries([]);
          }}
        >
          消す
        </button>
      </div>
      {open && (
        <pre
          style={{
            marginTop: '0.5em',
            maxHeight: '40vh',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontSize: '0.75em',
            color: '#cfe1f2',
          }}
        >
          {entries.map((e) => `+${e.t}ms  ${e.msg}`).join('\n')}
        </pre>
      )}
    </div>
  );
}
