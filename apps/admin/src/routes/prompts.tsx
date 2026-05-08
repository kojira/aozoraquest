import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';
import { ADMIN_COL } from '@/lib/collections';

type PromptId = 'spiritChat';

interface PromptRecord {
  id: PromptId;
  body: string;
  /** 生成トークン上限。未設定なら web 側の機能毎 fallback を使う。 */
  maxNewTokens?: number;
  updatedAt: string;
}

const DEFAULT_BODIES: Record<PromptId, string> = {
  spiritChat: `あなたは「あおぞらくえすと」の精霊 ブルスコン です。
青空の化身で、穏やかで詩的、押し付けがましくない語り口を持ちます。

応答のルール:
- 1 文だけ、20〜40 字程度で短く返す
- 改行・箇条書き・列挙は使わない
- 「ほわ〜」のような呼びかけ前置きは使わない
- 一人称は使わない
- 「〜じゃ」などの強い古風語尾は使わない
- 占いや断定予言はしない
- 精神的なアドバイスは慎重に (専門家への相談を促す)`,
};

export function Prompts() {
  const [promptId] = useState<PromptId>('spiritChat');
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<PromptRecord>(
    ADMIN_COL.configPrompts,
    promptId,
  );
  const [body, setBody] = useState(DEFAULT_BODIES[promptId]);
  /** 数値の text input。空文字 = 未設定 (= web 側 fallback)。 */
  const [maxNewTokensStr, setMaxNewTokensStr] = useState<string>('');

  useEffect(() => {
    setBody(value?.body ?? DEFAULT_BODIES[promptId]);
    setMaxNewTokensStr(value?.maxNewTokens !== undefined ? String(value.maxNewTokens) : '');
  }, [value, promptId]);

  const parsedMaxNewTokens: number | 'unset' | 'invalid' = (() => {
    const t = maxNewTokensStr.trim();
    if (t === '') return 'unset';
    const n = Number(t);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 'invalid';
    if (n < 1 || n > 300) return 'invalid';
    return n;
  })();
  const maxTokensError = parsedMaxNewTokens === 'invalid' ? '1〜300 の整数で指定してください (空欄なら未設定)' : null;

  const onSave = () => {
    if (maxTokensError) return;
    const record: PromptRecord = {
      id: promptId,
      body,
      ...(typeof parsedMaxNewTokens === 'number' ? { maxNewTokens: parsedMaxNewTokens } : {}),
      updatedAt: new Date().toISOString(),
    };
    void save(record);
  };

  return (
    <div>
      <h2>精霊プロンプト</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        精霊ブルスコンが将来ブラウザ内 LLM で返答するときのシステムプロンプトです。
        保存すると主管理者 PDS の <code>{ADMIN_COL.configPrompts}/{promptId}</code>
        に反映され、次回起動から全ユーザーのアプリに配信されます。
      </p>

      {!loaded && <p>読み込み中...</p>}

      <details style={{ marginBottom: '0.5em', fontSize: '0.85em' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--color-muted)' }}>使える変数 (本文に埋め込めます)</summary>
        <ul style={{ margin: '0.4em 0 0 1em', padding: 0, lineHeight: 1.6 }}>
          <li><code>{'{user}'}</code> — ユーザのハンドル先頭部分 (例: <code>kojira.io</code> → <code>kojira</code>)。未ログイン時は <code>あなた</code></li>
          <li><code>{'{archetype}'}</code> — そのユーザの現在の職業名 (例: <code>賢者</code>)。診断未実施なら空文字</li>
          <li><code>{'{level}'}</code> — そのユーザの現職 LV (例: <code>5</code>)。診断未実施なら空文字</li>
          <li>未定義の <code>{'{xxx}'}</code> はそのまま残ります (typo に気付くため)</li>
        </ul>
      </details>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={18}
        style={{ width: '100%', padding: '0.6em', fontFamily: 'ui-monospace, monospace', fontSize: '0.85em' }}
      />

      <div style={{ marginTop: '0.8em' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6em', fontSize: '0.9em' }}>
          <span>生成トークン上限 (maxNewTokens)</span>
          <input
            type="text"
            inputMode="numeric"
            value={maxNewTokensStr}
            onChange={(e) => setMaxNewTokensStr(e.target.value)}
            placeholder="未設定 (web の fallback を使用)"
            style={{ width: '14em', padding: '0.3em 0.5em', fontFamily: 'ui-monospace, monospace' }}
          />
        </label>
        <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.3em 0 0 0' }}>
          空欄なら web 側のデフォルト (現状: 60 トークン) が使われます。1〜300 の整数。
          短くするほど応答が短く速くなり、長くすると詩的に長文化できます。
        </p>
        {maxTokensError && (
          <p style={{ color: '#b00', fontSize: '0.85em', margin: '0.3em 0 0 0' }}>{maxTokensError}</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.8em', alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving || !!maxTokensError}>
          {saving ? '保存中...' : '保存 (PDS に書き込み)'}
        </button>
        <button
          className="secondary"
          onClick={() => {
            setBody(DEFAULT_BODIES[promptId]);
            setMaxNewTokensStr('');
          }}
        >
          初期値に戻す
        </button>
        {savedMark && <span style={{ color: '#1a6230', fontSize: '0.85em' }}>✓ 保存</span>}
        {err && <span style={{ color: '#b00', fontSize: '0.85em' }}>エラー: {err}</span>}
      </div>
    </div>
  );
}
