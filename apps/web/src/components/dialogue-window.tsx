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
 * DQ 風セリフウィンドウ。
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

/** 会話レイヤーの z。送り面 (透明背景) は footer 等の背後 UI より上に全画面で敷き、窓本体は
 *  さらにその上。地図内の HUD/戦闘 (world-hud の HUD_Z=2 / OVERLAY_Z=3) や地図枠より十分上、
 *  祝福の全画面演出 (welcome-blessing z=1100) よりは下。祖先に transform/filter が無いので
 *  position:fixed は viewport に貼れる (footer まで覆える) — anchor='map' でも同じ。 */
const DIALOGUE_BACKDROP_Z = 900;
const DIALOGUE_WINDOW_Z = 901;

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
   *  「マップ上」へ会話窓を出す。 */
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

  /** セリフを進める。**イベントは必ずここで止める** — 送り面は画面全体を覆う当たり判定なので、
   *  祖先に「背景タップで閉じる」オーバーレイ (なんでも屋の店窓) があると、セリフを送るタップが
   *  そのまま「閉じる」に伝わってしまう。#638: あいさつをタップすると店ごと閉じ、
   *  「つくってもらう」も送り面に吸われて押せなかった。呼び出し側で包むのではなく、
   *  全画面の当たり判定を持つ側で止めるのが正しい (今後どこに置いても同じ事故が起きない)。 */
  const advance = useCallback((e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    setSt((s) => advanceDialogue(lines, s));
  }, [lines]);

  const line = currentLine(lines, st);
  if (!line || st.done) return null;
  const complete = lineComplete(lines, st);

  return (
    <>
      {/* 送り面: **常に画面全体を覆う** 透明レイヤー。どこをタップしても会話が進み、footer や
          スティック等の背後 UI への誤タップ・誤遷移を防ぐ。anchor='map' で窓を地図に貼っても
          この送り面は viewport 全面のままなので、画面下端 (footer 際) を送ろうとしても効く
          (地図枠だけを覆うと footer 遷移で会話が中断する回帰があった — レビュー ★★)。 */}
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label={line.speaker ? `${line.speaker}のセリフ` : 'セリフ'}
        onClick={advance}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            advance(e);
          }
        }}
        tabIndex={0}
        style={{ position: 'fixed', inset: 0, zIndex: DIALOGUE_BACKDROP_Z, cursor: 'pointer', background: 'transparent' }}
      />
      {/* 窓本体: 'viewport' は footer 際に固定、'map' は直近の position:relative 祖先
          (ワールドの地図枠) の下端に貼る (DQ 風)。送り面より上 (z)。 */}
      <div
        onClick={advance}
        style={{
          position: onMap ? 'absolute' : 'fixed',
          left: '50%',
          // 'map': 地図枠の下端に貼る (DQ 風)。'viewport': footer 実測高 (app-shell) に追従
          bottom: onMap ? '0.5em' : 'calc(var(--footer-height, 4.5em) + 0.5em)',
          transform: 'translateX(-50%)',
          width: onMap ? 'calc(100% - 0.8em)' : 'min(94vw, 520px)',
          maxWidth: 520,
          zIndex: DIALOGUE_WINDOW_Z,
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
          // maxHeight/overflowY: 将来の長い NPC セリフでも窓がアバターに被らないよう上限を設ける
          //   (DQ も 1 窓は数行で固定 — レビュー ★★)。marginBottom:0: dq-window 既定の 0.9em を
          //   打ち消し、地図枠の下端 (bottom:0.5em) にぴったり寄せる (レビュー ★)。
          style={{ padding: '0.7em 0.9em 0.8em', minHeight: '5.8em', maxHeight: '34vh', overflowY: 'auto', marginBottom: 0, fontSize: '0.92em', lineHeight: 1.7 }}
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
    </>
  );
}
