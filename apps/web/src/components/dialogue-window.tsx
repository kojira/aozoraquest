import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceDialogue,
  charCount,
  currentLine,
  lineComplete,
  startDialogue,
  tickDialogue,
  visibleText,
  type DialogueChoice,
  type DialogueLine,
  type DialogueState,
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

import { NpcPortrait } from './npc-image';
import { StoryEffectLayer } from './story-effect-layer';
import { storyEffectState, transientStoryEffects } from '@/lib/story-effects';

const CHAR_MS = 45;

/** 会話レイヤーの z。送り面 (透明背景) は footer 等の背後 UI より上に全画面で敷き、窓本体は
 *  さらにその上。地図内の HUD/戦闘 (world-hud の HUD_Z=2 / OVERLAY_Z=3) や地図枠より十分上、
 *  祝福の全画面演出 (welcome-blessing z=1100) よりは下。祖先に transform/filter が無いので
 *  position:fixed は viewport に貼れる (footer まで覆える) — anchor='map' でも同じ。 */
const DIALOGUE_BACKDROP_Z = 900;
const DIALOGUE_WINDOW_Z = 901;

/** 選択肢を出す状態か: 選択肢があり、最後の行を全文表示し終えている。 */
function choicesShown(lines: readonly DialogueLine[], st: DialogueState, choices: readonly DialogueChoice[] | undefined): boolean {
  return !!choices && choices.length > 0 && !st.done && st.index === lines.length - 1 && lineComplete(lines, st);
}

/** 段ごとに一過性演出の鍵を変える (同じ index でも段が変われば再生し直す)。 */
const stepIds = new WeakMap<object, number>();
let nextStepId = 0;
function stepKey(step: unknown): string {
  if (step && typeof step === 'object') {
    if (!stepIds.has(step)) stepIds.set(step, ++nextStepId);
    return `o${stepIds.get(step)}`;
  }
  return String(step);
}

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
  portrait,
  onDone,
  choices,
  busy = false,
  anchor = 'viewport',
  conversationStep,
}: {
  lines: readonly DialogueLine[];
  /** 話者名プレートに添えるアイコン (例: ブルスコンは SpiritIcon — 他画面の
   *  吹き出しと同じ顔で認識できるように)。NPC ごとの出し分けは呼び出し側の責務 */
  plateIcon?: React.ReactNode;
  /** Supplied only by an NPC conversation, never inferred from a speaker name.
   *  話者のある行だけに出す (地の文の行では出さない。#696 導入の「倒れていた」語り)。 */
  portrait?: { src: string; name: string } | undefined;
  /** 全行を送り終えた (選択肢があればどれかを選んだ) ときに一度だけ呼ぶ */
  onDone: () => void;
  /** 最後の行を読み終えたら出す選択肢 (「はい / いいえ」)。あるあいだは送り面のタップで
   *  閉じない (選ぶまで待つ)。onSelect の成功後に onDone。失敗時は再選択できる */
  choices?: readonly DialogueChoice[] | undefined;
  busy?: boolean;
  /** 出す位置。'viewport' = 画面下端 (footer 際) に固定 (既定)。'map' = 直近の
   *  position:relative 祖先 (ワールドの地図枠) の下部にオーバーレイし、DQ 風に
   *  「マップ上」へ会話窓を出す。 */
  anchor?: 'viewport' | 'map';
  /** 同じ会話の次の段 (ギルドの 受付→メニュー→話す 等)。変わったら行・選択・done を数え直すが、
   *  窓は作り直さない (D-DIALOGUE-004: 段ごとの作り直しで送り面の暗転が再生されて明滅し、
   *  会話イラストの再取得中は絵が消えていた)。Object.is で比べる。 */
  conversationStep?: unknown;
}) {
  // 進行状態は段と一緒に持つ: 前の段への done 等が、次の段へ漏れない。
  const [view, setView] = useState(() => ({ step: conversationStep, st: startDialogue() }));
  if (!Object.is(view.step, conversationStep)) setView({ step: conversationStep, st: startDialogue() });
  const { step, st } = view;
  // 更新はその段にだけ効かせる (前の段の interval/送り/選択の結果を、次の段へ持ち込まない)。
  const setSt = useCallback((next: (s: DialogueState) => DialogueState) =>
    setView((v) => (Object.is(v.step, step) ? { ...v, st: next(v.st) } : v)), [step]);
  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // done 通知済み / 選択処理中の段 ({ step } の箱。null = なし)。
  const doneRef = useRef<{ step: unknown } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const choosingRef = useRef<{ step: unknown } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const scrolledGesture = useRef(false);
  const onMap = anchor === 'map';

  useEffect(() => {
    if (onMap && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [onMap, st.index, step]);

  // 会話中にTabで背後のもちもの/移動UIへ抜けない。
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const targets: HTMLElement[] = [overlayRef.current, ...(onMap ? [bodyRef.current] : []), ...Array.from(windowRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])].filter((n): n is HTMLDivElement | HTMLButtonElement => !!n);
      if (!targets.length) return;
      e.preventDefault();
      const index = targets.indexOf(document.activeElement as HTMLElement);
      targets[(index + (e.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, [onMap]);

  // 空の lines でも必ず done になる (呼び出し側は表示中 move ガード等を掛けるため、
  // ここで止まると不可視のまま永久ブロックになる — 動的生成セリフ時代への契約。レビュー指摘)
  useEffect(() => {
    if (lines.length === 0) setSt((s) => (s.done ? s : { ...s, done: true }));
  }, [lines.length, setSt]);

  // ★ キーボード操作: mount 時と次の段でオーバーレイへフォーカス (Enter/Space で送れるように。
  // 選んだ選択肢ボタンは次の段で消える)
  useEffect(() => {
    overlayRef.current?.focus();
  }, [step]);

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
  }, [lines, st.index, st.done, reduced, setSt]);

  // done は effect 経由で一度だけ通知 (render 中の親 setState を避ける)
  useEffect(() => {
    if (st.done && !(doneRef.current && Object.is(doneRef.current.step, step))) {
      doneRef.current = { step };
      onDone();
    }
  }, [st.done, onDone, step]);

  /** セリフを進める。**イベントは必ずここで止める** — 送り面は画面全体を覆う当たり判定なので、
   *  祖先に「背景タップで閉じる」オーバーレイ (なんでも屋の店窓) があると、セリフを送るタップが
   *  そのまま「閉じる」に伝わってしまう。#638: あいさつをタップすると店ごと閉じ、
   *  「つくってもらう」も送り面に吸われて押せなかった。呼び出し側で包むのではなく、
   *  全画面の当たり判定を持つ側で止めるのが正しい (今後どこに置いても同じ事故が起きない)。 */
  const advance = useCallback((e?: { stopPropagation: () => void }) => {
    e?.stopPropagation();
    if (busy || (choosingRef.current && Object.is(choosingRef.current.step, step))) return;
    if (choicesShown(lines, st, choices)) return;
    const next = advanceDialogue(lines, st);
    setSt(() => next);
    // 最後の送りは同じイベントで通知する: 呼出側の「閉じる/次の段」と同じ描画にまとまり、
    // done のまま残った窓が一瞬だけ出続けない。
    if (next.done && !(doneRef.current && Object.is(doneRef.current.step, step))) {
      doneRef.current = { step };
      onDone();
    }
  }, [lines, choices, busy, step, setSt, st, onDone]);

  const line = currentLine(lines, st);
  const asking = choicesShown(lines, st, choices);
  // Keep focus on the dialogue surface: held Enter must not select "はい".
  // 段つきの会話は done 後も最後の行を残す: 呼出側が次の段を渡すか閉じるまで、送り面と会話
  // イラストを外さない (外すと暗転アニメが最初から再生され、画面が明滅する)。
  if (!line || (st.done && conversationStep === undefined)) return null;
  const complete = lineComplete(lines, st);
  // 演出 (D-STORY-007) は地図枠に出すときだけ。段と行を鍵に一過性の演出を一度だけ再生する。
  const effectsShown = onMap && lines.some((l) => l.effects?.length);
  const shownPortrait = line.speaker ? line.portrait ?? portrait : undefined;

  return (
    <>
      {/* 送り面: **常に画面全体を覆う** レイヤー。どこをタップしても会話が進み、footer や
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
        // 背後をわずかに暗くする (#640)。全画面が当たり判定なのに見た目が素通しだと
        // 「いま会話中で、ほかは触れない」ことが伝わらない (実機で存在感が薄いと指摘)。
        className="aq-dialogue-backdrop"
        style={{ position: 'fixed', inset: 0, zIndex: DIALOGUE_BACKDROP_Z, cursor: 'pointer' }}
      />
      {effectsShown && (
        <StoryEffectLayer state={storyEffectState(lines, st.index)} transient={transientStoryEffects(line, reduced)}
          playKey={`${stepKey(step)}:${st.index}`} reduced={reduced} />
      )}
      {/* 窓本体: 'viewport' は footer 際に固定、'map' は直近の position:relative 祖先
          (ワールドの地図枠) の下端に貼る (DQ 風)。送り面より上 (z)。 */}
      <div
        ref={windowRef}
        onClick={advance}
        onPointerDownCapture={onMap ? (e) => {
          pointerOrigin.current = { x: e.clientX, y: e.clientY };
          scrolledGesture.current = false;
        } : undefined}
        onPointerMoveCapture={onMap ? (e) => {
          const start = pointerOrigin.current;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) scrolledGesture.current = true;
        } : undefined}
        onPointerUpCapture={onMap ? () => { pointerOrigin.current = null; } : undefined}
        onPointerCancelCapture={onMap ? () => { pointerOrigin.current = null; scrolledGesture.current = true; } : undefined}
        onScrollCapture={onMap ? () => { if (pointerOrigin.current) scrolledGesture.current = true; } : undefined}
        onClickCapture={onMap ? (e) => {
          // A drag/scroll must neither advance speech nor select the button it ends on.
          if (e.detail !== 0 && scrolledGesture.current) { e.preventDefault(); e.stopPropagation(); }
        } : undefined}
        style={{
          position: onMap ? 'absolute' : 'fixed',
          left: '50%',
          // 'map': 地図枠の下端に貼る (DQ 風)。'viewport': footer 実測高 (app-shell) に追従
          bottom: onMap ? 0 : 'calc(var(--footer-height, 4.5em) + 0.5em)',
          transform: 'translateX(-50%)',
          width: onMap ? '96%' : 'min(94vw, 520px)',
          maxWidth: onMap ? undefined : 520,
          ...(onMap ? {
            // Map-inner percentages, independent of text/choices/portrait presence.
            height: '100%', pointerEvents: 'none' as const,
          } : shownPortrait ? { maxHeight: 'calc(100dvh - var(--footer-height, 4.5em) - 1em)', overflowY: 'auto' as const } : {}),
          zIndex: DIALOGUE_WINDOW_Z,
        }}
      >
        {shownPortrait && (onMap ? (
          // The lower part of the portrait sits behind the opaque text window (35% tall) so its cut edge is hidden.
          <div style={{ position: 'absolute', top: '0.5em', bottom: 'calc(0.5em + 27%)', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <NpcPortrait src={shownPortrait.src} name={shownPortrait.name} fitMap />
          </div>
        ) : <NpcPortrait src={shownPortrait.src} name={shownPortrait.name} />)}
        {line.speaker && (
          <div
            className="dq-window aq-dialogue-pane"
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
              // .8em font: .625em gap / 2.5em plate = .5em / 2em in map-parent units.
              ...(onMap ? { position: 'absolute' as const, bottom: 'calc(35% + 0.625em)', height: '2.5em', maxWidth: 'calc(100% - 8px)', whiteSpace: 'nowrap' as const, overflow: 'hidden', pointerEvents: 'auto' as const } : {}),
            }}
          >
            {plateIcon}
            {line.speaker}
          </div>
        )}
        <div
          className="dq-window aq-dialogue-pane"
          ref={bodyRef}
          tabIndex={onMap ? 0 : undefined}
          onKeyDown={onMap ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(e); }
          } : undefined}
          // Keep the .5em map-parent gap despite the body's .92em font; border box is exactly 35%.
          style={{ padding: '0.7em 0.9em 0.8em', minHeight: onMap ? 0 : '5.8em', maxHeight: onMap ? undefined : '34vh', overflowY: 'auto', marginBottom: 0, fontSize: '0.92em', lineHeight: 1.7,
            ...(onMap ? { position: 'absolute', bottom: `${0.5 / 0.92}em`, width: '100%', height: '35%', boxSizing: 'border-box', overscrollBehavior: 'contain', pointerEvents: 'auto' } : {}) }}
        >
          {/* 部分文字列の逐次読み上げは SR に不向きなので、全文を visually-hidden で
              先に置き、タイプ表示は aria-hidden にする (汎用要素の aria-label は
              多くの SR が無視する — レビュー指摘) */}
          <span style={SR_ONLY}>{line.text}</span>
          <span aria-hidden>{visibleText(line.text, st.chars)}</span>
          {complete && !asking && (
            <span aria-hidden className="aq-dialogue-next" style={{ float: 'right', marginTop: '0.6em' }}>
              ▼
            </span>
          )}
          {asking && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '0.5em', marginTop: '0.4em' }}>
              {choices!.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  disabled={busy}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (busy || (choosingRef.current && Object.is(choosingRef.current.step, step))) return;
                    const chosen = { step };
                    choosingRef.current = chosen;
                    // 選んだ段だけを閉じる (onSelect が次の段を渡していても、その段は閉じない)。
                    const finish = () => {
                      if (!(doneRef.current && Object.is(doneRef.current.step, step))) {
                        doneRef.current = { step };
                        setSt((s) => ({ ...s, done: true }));
                        onDone();
                      }
                    };
                    const retry = () => { if (choosingRef.current === chosen) choosingRef.current = null; };
                    try {
                      const result = c.onSelect();
                      if (result && typeof result.then === 'function') {
                        void result.then(finish, retry);
                      } else finish();
                    } catch { retry(); }
                  }}
                  style={{ padding: '0.3em 1.2em', fontSize: '0.95em', maxWidth: '100%', overflowWrap: 'anywhere', whiteSpace: 'normal', touchAction: 'manipulation' }}
                >
                  {c.label}
                </button>
              ))}
            </div>
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
