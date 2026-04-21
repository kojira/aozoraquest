import { useEffect, useState } from 'react';
import { useAdminConfig } from '@/lib/use-config';

type PromptId = 'spiritChat' | 'draftPost' | 'advancedDiagnosis';

interface PromptRecord {
  id: PromptId;
  body: string;
  updatedAt: string;
}

const DEFAULT_BODIES: Record<PromptId, string> = {
  spiritChat: `あなたは Aozora Quest の精霊です。青空の化身で、穏やかで詩的、
押し付けがましくない語り口を持ちます。

応答のルール:
- 100 字以内で返す
- 一人称は「わたし」
- 「〜じゃ」などの強い古風語尾は使わない
- 自然で穏やかに
- 占いや断定予言はしない
- 精神的なアドバイスは慎重に (専門家への相談を促す)`,
  draftPost: `(投稿下書き支援のプロンプト、将来)`,
  advancedDiagnosis: `(上位診断のプロンプト、将来)`,
};

export function Prompts() {
  const [promptId, setPromptId] = useState<PromptId>('spiritChat');
  const { loaded, value, save, saving, err, savedMark } = useAdminConfig<PromptRecord>(
    'app.aozoraquest.config.prompts',
    promptId,
  );
  const [body, setBody] = useState(DEFAULT_BODIES[promptId]);

  useEffect(() => {
    setBody(value?.body ?? DEFAULT_BODIES[promptId]);
  }, [value, promptId]);

  const onSave = () => {
    const record: PromptRecord = { id: promptId, body, updatedAt: new Date().toISOString() };
    void save(record);
  };

  return (
    <div>
      <h2>システムプロンプト編集</h2>
      <p style={{ color: 'var(--color-muted)' }}>
        BYOK ユーザーの外部 LLM 呼び出しに使われるプロンプト。保存すると主管理者 PDS の
        <code> app.aozoraquest.config.prompts/{promptId}</code> に反映。
      </p>

      <div className="section">
        <label>
          対象:{' '}
          <select value={promptId} onChange={(e) => setPromptId(e.target.value as PromptId)}>
            <option value="spiritChat">spiritChat (精霊自由対話)</option>
            <option value="draftPost">draftPost (投稿下書き、将来)</option>
            <option value="advancedDiagnosis">advancedDiagnosis (上位診断、将来)</option>
          </select>
        </label>
      </div>

      {!loaded && <p>読み込み中...</p>}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={20}
        style={{ width: '100%', padding: '0.6em', fontFamily: 'ui-monospace, monospace', fontSize: '0.85em' }}
      />

      <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em', alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving}>{saving ? '保存中...' : '保存 (PDS に書き込み)'}</button>
        <button className="secondary" onClick={() => setBody(DEFAULT_BODIES[promptId])}>初期値に戻す</button>
        {savedMark && <span style={{ color: '#1a6230', fontSize: '0.85em' }}>✓ 保存</span>}
        {err && <span style={{ color: '#b00', fontSize: '0.85em' }}>エラー: {err}</span>}
      </div>
    </div>
  );
}
