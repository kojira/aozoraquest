import type { CSSProperties } from 'react';
import type { CogFunction, CognitiveScores } from '@aozoraquest/core';
import { useCognitiveAnalysis } from '@/lib/post-cognitive';

const FN_LABEL: Record<CogFunction, string> = {
  Ni: '内向直観',
  Ne: '外向直観',
  Si: '内向感覚',
  Se: '外向感覚',
  Ti: '内向思考',
  Te: '外向思考',
  Fi: '内向感情',
  Fe: '外向感情',
};

const FN_COLOR: Record<CogFunction, string> = {
  Ni: '#9aa9d8',
  Ne: '#9ad8c2',
  Si: '#d89aaf',
  Se: '#d8c79a',
  Ti: '#9ac1d8',
  Te: '#d89a9a',
  Fi: '#c79ad8',
  Fe: '#c0d89a',
};

function topN(scores: CognitiveScores, n: number): Array<{ fn: CogFunction; v: number }> {
  return (Object.entries(scores) as [CogFunction, number][])
    .map(([fn, v]) => ({ fn, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n);
}

const baseStyle: CSSProperties = {
  fontSize: '0.75em',
  color: 'var(--color-muted)',
  marginTop: '0.3em',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.4em',
};

const linkButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'var(--color-accent)',
  cursor: 'pointer',
  fontSize: 'inherit',
  textDecoration: 'underline',
};

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export interface PostCognitiveBadgeProps {
  postUri: string | undefined;
  text: string;
}

/**
 * 投稿テキストの cognitive function 判定バッジ。
 * 設定 ON で auto 起動 / OFF でも「🧠 気質を分析」ボタンから個別起動可。
 */
export function PostCognitiveBadge({ postUri, text }: PostCognitiveBadgeProps) {
  const { state, scores, error, triggerAnalyze, canAnalyze } = useCognitiveAnalysis(postUri, text);
  if (!canAnalyze) return null;

  if (state === 'idle') {
    return (
      <div style={baseStyle}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerAnalyze();
          }}
          style={linkButtonStyle}
        >
          🧠 気質を分析
        </button>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div style={baseStyle}>
        <span>🧠 分析中…</span>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div style={{ ...baseStyle, color: 'var(--color-danger)' }}>
        <span>🧠 分析失敗</span>
        {error && <span style={{ opacity: 0.7 }}>({truncate(error, 40)})</span>}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            triggerAnalyze();
          }}
          style={linkButtonStyle}
        >
          再試行
        </button>
      </div>
    );
  }
  if (state === 'skipped' || !scores) return null;

  const top = topN(scores, 3);
  return (
    <div style={baseStyle} title="この投稿テキストから推定した心理機能スコア (上位 3, 0–100 正規化)">
      <span>🧠</span>
      {top.map(({ fn, v }) => (
        <span
          key={fn}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3em',
            padding: '0.05em 0.45em',
            borderRadius: 999,
            background: FN_COLOR[fn] + '33',
            border: `1px solid ${FN_COLOR[fn]}99`,
            color: 'var(--color-text)',
          }}
          title={`${fn} (${FN_LABEL[fn]}) — 強度 ${v}/100`}
        >
          <strong>{fn}</strong>
          <span style={{ opacity: 0.8 }}>{v}</span>
        </span>
      ))}
    </div>
  );
}
