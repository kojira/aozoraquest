/**
 * アイコン + テキストの目立つ link。
 * 主要 CTA (掲示板、ポートフォリオ等) で使う。
 *
 * DESIGN.md の button スタイルに準拠 (rounded 2px、白枠、半透明背景)。
 * ただし border は弱め (透明感) で「link なんだけど目立つ」中間的な見た目。
 */
import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';

interface ActionLinkProps {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
  variant?: 'pill' | 'inline';
  /** size 上書き (= アイコンの px。inline=18, pill=20) */
  iconSize?: number;
}

export function ActionLink({ to, icon, children, variant = 'pill' }: ActionLinkProps) {
  const style = variant === 'pill' ? pillStyle : inlineStyle;
  return (
    <Link to={to} style={style} className="aq-action-link">
      {icon}
      <span>{children}</span>
    </Link>
  );
}

const pillStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4em',
  padding: '0.35em 0.8em',
  background: 'rgba(0, 0, 0, 0.45)',
  border: '2px solid rgba(255, 255, 255, 0.85)',
  borderRadius: '2px',
  color: '#ffffff',
  textDecoration: 'none',
  fontSize: '0.95em',
  fontWeight: 500,
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)',
  WebkitTapHighlightColor: 'transparent',
  transition: 'background-color 80ms ease, transform 60ms ease',
};

const inlineStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35em',
  color: 'var(--color-accent)',
  textDecoration: 'none',
  borderBottom: '1px dotted var(--color-accent)',
  fontSize: '0.95em',
  paddingBottom: '1px',
};
