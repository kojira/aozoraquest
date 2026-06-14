import type { CSSProperties } from 'react';
import type { CogFunction, CognitiveScores } from '@aozoraquest/core';
import { useCognitiveAnalysis } from '@/lib/post-cognitive';
import { BrainIcon } from './icons';

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

/** カード右上に浮かべる脳アイコンのボタン (気質分析トリガー)。文字は出さない。 */
const triggerStyle: CSSProperties = {
  position: 'absolute',
  top: '0.5em',
  right: '0.6em',
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  padding: '0.2em',
  cursor: 'pointer',
  boxShadow: 'none',
  lineHeight: 0,
};

export interface PostCognitiveBadgeProps {
  postUri: string | undefined;
  text: string;
}

/**
 * 投稿テキストの cognitive function 判定。
 * - idle / loading / error: カード右上に脳アイコンだけを浮かべる (文字無し)。
 *   タップで分析起動 (設定 ON なら自動起動)。絵文字は使わず SVG。
 * - done: 推定した心理機能スコア (上位 3) をインラインのチップで表示。
 * 配置の前提: 親カードが `.dq-window` (position: relative)。
 */
export function PostCognitiveBadge({ postUri, text }: PostCognitiveBadgeProps) {
  const { state, scores, error, triggerAnalyze, canAnalyze } = useCognitiveAnalysis(postUri, text);
  if (!canAnalyze) return null;

  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); triggerAnalyze(); }}
        style={{ ...triggerStyle, color: 'var(--color-muted)' }}
        aria-label="この投稿の気質を分析"
        title="この投稿の気質を分析"
      >
        <BrainIcon size={18} />
      </button>
    );
  }
  if (state === 'loading') {
    return (
      <span style={{ ...triggerStyle, color: 'var(--color-accent)', opacity: 0.7, cursor: 'default' }} aria-label="気質を分析中" title="気質を分析中…">
        <BrainIcon size={18} />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); triggerAnalyze(); }}
        style={{ ...triggerStyle, color: 'var(--color-danger)' }}
        aria-label={`気質の分析に失敗${error ? ` (${error})` : ''} — 再試行`}
        title={`分析失敗${error ? ` (${error})` : ''} — タップで再試行`}
      >
        <BrainIcon size={18} />
      </button>
    );
  }
  if (state === 'skipped' || !scores) return null;

  const top = topN(scores, 3);
  return (
    <div style={baseStyle} title="この投稿テキストから推定した心理機能スコア (上位 3, 0–100 正規化)">
      <BrainIcon size={14} style={{ opacity: 0.7 }} />
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
