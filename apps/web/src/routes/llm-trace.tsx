import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { readLlmTrace, clearLlmTrace } from '@/lib/llm-trace';

/**
 * LLM トレース閲覧専用ルート (/llm-trace)。
 *
 * iOS Safari の OOM クラッシュ後、/spirit に戻ると別の重い処理が走って
 * すぐ再クラッシュ → trace を読む暇がない、という問題の対策。
 * このルートは localStorage を読むだけで他の重い import を行わない軽量
 * ページ。クラッシュ後はここに直接アクセスして末尾エントリを確認する。
 */
export function LlmTraceView() {
  const [entries, setEntries] = useState(() => readLlmTrace());

  useEffect(() => {
    setEntries(readLlmTrace());
  }, []);

  return (
    <div style={{ padding: '1em' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.6em' }}>
        <h2 style={{ margin: 0 }}>LLM トレース</h2>
        <span style={{ color: 'var(--color-muted)' }}>{entries.length} 件</span>
        <button
          style={{ marginLeft: 'auto', padding: '0.3em 0.8em' }}
          onClick={() => {
            clearLlmTrace();
            setEntries([]);
          }}
        >
          クリア
        </button>
        <Link to="/" style={{ padding: '0.3em 0.8em' }}>
          戻る
        </Link>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>トレースなし</p>
      ) : (
        <>
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>
            末尾 (最新) を上に表示。クラッシュ直前のステップが先頭。
          </p>
          <pre
            style={{
              padding: '0.6em',
              background: 'rgba(0,0,0,0.5)',
              borderRadius: 4,
              overflow: 'auto',
              maxHeight: '70vh',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontSize: '0.8em',
              color: '#cfe1f2',
            }}
          >
            {[...entries]
              .reverse()
              .map((e, idx) => `${idx === 0 ? '★ ' : '  '}+${e.t}ms  ${e.msg}`)
              .join('\n')}
          </pre>
        </>
      )}
    </div>
  );
}
