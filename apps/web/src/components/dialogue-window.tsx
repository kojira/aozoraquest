import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceDialogue,
  currentLine,
  lineComplete,
  startDialogue,
  tickDialogue,
  type DialogueLine,
} from '@/lib/dialogue';

/**
 * DQ 風セリフウィンドウ (オーナー指示 2026-07-18)。
 *
 * 画面下部のウィンドウに話者名プレート + セリフを 1 文字ずつ表示する。
 * どこをタップしても進む (タイプ中 → 全文表示、全文表示中 → 次の行)。
 * オンボーディングで導入し、今後の NPC 会話 (ギルド・住人) はすべて
 * このコンポーネントを使う。進行ロジックは lib/dialogue.ts (純関数・テスト済)。
 *
 * - reduced-motion では 1 文字送りをやめて行を即時全文表示する
 * - 全文表示済みの行には ▼ を点滅させる (DQ の「送れます」記号)
 */

const CHAR_MS = 45;

export function DialogueWindow({ lines, onDone }: { lines: readonly DialogueLine[]; onDone: () => void }) {
  const [st, setSt] = useState(startDialogue);
  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const doneRef = useRef(false);

  // タイプ進行。reduced-motion では行頭で即全文にする
  useEffect(() => {
    if (st.done) return;
    if (reduced) {
      if (!lineComplete(lines, st)) setSt((s) => ({ ...s, chars: currentLine(lines, s)?.text.length ?? 0 }));
      return;
    }
    if (lineComplete(lines, st)) return;
    const id = setInterval(() => setSt((s) => tickDialogue(lines, s)), CHAR_MS);
    return () => clearInterval(id);
  }, [lines, st, reduced]);

  // done は effect 経由で一度だけ通知 (render 中の親 setState を避ける)
  useEffect(() => {
    if (st.done && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [st.done, onDone]);

  const advance = useCallback(() => setSt((s) => advanceDialogue(lines, s)), [lines]);

  const line = currentLine(lines, st);
  if (!line || st.done) return null;
  const complete = lineComplete(lines, st);

  return (
    // 全面オーバーレイ: どこをタップしても会話が進む (DQ の会話送り)。
    // 背後の UI (スティック・ボタン) への誤タップもこれで防ぐ
    <div
      role="dialog"
      aria-label={line.speaker ? `${line.speaker}のセリフ` : 'セリフ'}
      onClick={advance}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          advance();
        }
      }}
      tabIndex={0}
      style={{ position: 'fixed', inset: 0, zIndex: 900, cursor: 'pointer', background: 'transparent' }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)',
          transform: 'translateX(-50%)',
          width: 'min(94vw, 520px)',
        }}
      >
        {line.speaker && (
          <div
            className="dq-window"
            style={{
              display: 'inline-block',
              padding: '0.15em 0.8em',
              marginBottom: -2,
              marginLeft: 8,
              fontSize: '0.8em',
              fontWeight: 700,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {line.speaker}
          </div>
        )}
        <div
          className="dq-window"
          style={{ padding: '0.7em 0.9em 0.8em', minHeight: '4.6em', fontSize: '0.92em', lineHeight: 1.7 }}
        >
          {/* 部分文字列の逐次読み上げは SR に不向きなので、全文を aria-label で渡す */}
          <span aria-label={line.text}>
            <span aria-hidden>{line.text.slice(0, st.chars)}</span>
          </span>
          {complete && (
            <span aria-hidden className="aq-dialogue-next" style={{ float: 'right', marginTop: '0.6em' }}>
              ▼
            </span>
          )}
        </div>
        <style>{`
@keyframes aq-dialogue-blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
.aq-dialogue-next { animation: aq-dialogue-blink 0.9s step-end infinite; }
@media (prefers-reduced-motion: reduce) { .aq-dialogue-next { animation: none; } }
`}</style>
      </div>
    </div>
  );
}
