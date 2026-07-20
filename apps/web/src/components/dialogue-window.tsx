import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceDialogue,
  charCount,
  currentLine,
  lineComplete,
  startDialogue,
  tickDialogue,
  visibleText,
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

/** visually-hidden (スクリーンリーダーにだけ全文を渡す) */
const SR_ONLY: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function DialogueWindow({
  lines,
  plateIcon,
  onDone,
  anchor = 'viewport',
}: {
  lines: readonly DialogueLine[];
  /** 話者名プレートに添えるアイコン (例: ブルスコンは SpiritIcon — 他画面の
   *  吹き出しと同じ顔で認識できるように)。NPC ごとの出し分けは呼び出し側の責務 */
  plateIcon?: React.ReactNode;
  onDone: () => void;
  /** 出す位置。'viewport' = 画面下端 (footer 際) に固定 (既定)。'map' = 直近の
   *  position:relative 祖先 (ワールドの地図枠) の下部にオーバーレイし、DQ 風に
   *  「マップ上」へ会話窓を出す (オーナー指摘 2026-07-20)。 */
  anchor?: 'viewport' | 'map';
}) {
  const onMap = anchor === 'map';
  const [st, setSt] = useState(startDialogue);
  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const doneRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 空の lines でも必ず done になる (呼び出し側は表示中 move ガード等を掛けるため、
  // ここで止まると不可視のまま永久ブロックになる — 動的生成セリフ時代への契約。レビュー指摘)
  useEffect(() => {
    if (lines.length === 0) setSt((s) => (s.done ? s : { ...s, done: true }));
  }, [lines.length]);

  // ★ キーボード操作: mount 時にオーバーレイへフォーカス (Enter/Space で送れるように)
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);

  // タイプ進行。interval は行単位で張る (依存に st 全体を入れると 1 文字ごとに
  // clear→再生成される setTimeout チェーンになる — レビュー指摘)。tickDialogue は
  // 全文表示後 no-op なので、行が変わるまで回り続けても状態は進まない。
  // reduced-motion では行頭で即全文にする
  useEffect(() => {
    if (st.done) return;
    if (reduced) {
      setSt((s) => {
        const line = currentLine(lines, s);
        return line ? { ...s, chars: charCount(line.text) } : s;
      });
      return;
    }
    const id = setInterval(() => setSt((s) => tickDialogue(lines, s)), CHAR_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- interval は行 (index) 単位
  }, [lines, st.index, st.done, reduced]);

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
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={line.speaker ? `${line.speaker}のセリフ` : 'セリフ'}
      onClick={advance}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          advance();
        }
      }}
      tabIndex={0}
      style={{
        // 'map' は地図枠内 (absolute) に敷く。z は地図内の HUD/戦闘 (HUD_Z=2/OVERLAY_Z=3)
        // より上。'viewport' は従来どおり画面全体に固定。
        position: onMap ? 'absolute' : 'fixed',
        inset: 0,
        zIndex: onMap ? 12 : 900,
        cursor: 'pointer',
        background: 'transparent',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '50%',
          // 'map': 地図枠の下端に貼る (DQ 風)。'viewport': footer 実測高 (app-shell) に追従
          bottom: onMap ? '0.5em' : 'calc(var(--footer-height, 4.5em) + 0.5em)',
          transform: 'translateX(-50%)',
          width: onMap ? 'calc(100% - 0.8em)' : 'min(94vw, 520px)',
          maxWidth: 520,
        }}
      >
        {line.speaker && (
          <div
            className="dq-window"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35em',
              padding: '0.15em 0.8em',
              marginBottom: -2,
              marginLeft: 8,
              fontSize: '0.8em',
              fontWeight: 700,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {plateIcon}
            {line.speaker}
          </div>
        )}
        <div
          className="dq-window"
          style={{ padding: '0.7em 0.9em 0.8em', minHeight: '5.8em', fontSize: '0.92em', lineHeight: 1.7 }}
        >
          {/* 部分文字列の逐次読み上げは SR に不向きなので、全文を visually-hidden で
              先に置き、タイプ表示は aria-hidden にする (汎用要素の aria-label は
              多くの SR が無視する — レビュー指摘) */}
          <span style={SR_ONLY}>{line.text}</span>
          <span aria-hidden>{visibleText(line.text, st.chars)}</span>
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
