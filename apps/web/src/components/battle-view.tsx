import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 戦闘 UI の共有パーツ。かつてのブルスコンの試練が使っていた
 * BattleView / BattleScene / BattleCommands は試練撤去に伴い削除し、
 * あおぞらワールドの戦闘 (world-battle-controls) が今も使う HpBar と
 * TypedLines だけを残した。
 */

export function HpBar({ name, hp, maxHp, mine = false, labelColor }: { name: string; hp: number; maxHp: number; mine?: boolean; labelColor?: string }) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const color = ratio > 0.5 ? '#5fc37e' : ratio > 0.25 ? '#f5c542' : '#e8566a';
  const textShadow = labelColor ? '0 1px 2px rgba(0,0,0,0.9)' : undefined;
  return (
    <div style={{ maxWidth: 340, margin: '0.3em auto 0', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78em', color: labelColor, textShadow }}>
        <span>{mine ? `▶ ${name}` : name}</span>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{hp} / {maxHp}</span>
      </div>
      <div style={{ height: 8, background: 'var(--color-track-bg)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${ratio * 100}%`, height: '100%', background: color, transition: 'width 300ms ease' }} />
      </div>
    </div>
  );
}

/** 戦闘ログの DQ1 風タイプライター表示。行を順に 1 文字ずつ出す。
 *  reduced-motion では即時全文。セリフウィンドウ (dialogue-window) より速い
 *  1 文字 22ms — 戦闘のテンポを削らない速度に留める。battle-view 専用。
 *  onDone: 全文表示し終えた時に一度呼ぶ (DQ 風メッセージ送りの「送り可」判定用)。 */
export function TypedLines({ lines, onDone }: { lines: readonly string[]; onDone?: () => void }) {
  const reduced = useMemo(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  // lines は毎レンダー新配列 (map で生成) なので、打ち直しの契機は内容文字列で
  // 判定する — 親 (World) の notice 更新等の無関係な再レンダーで頭から
  // タイプし直さない (レビュー指摘)
  const joined = lines.join('\n');
  // code point 単位 (絵文字がサロゲート半欠けで表示されない — レビュー指摘)
  const cps = useMemo(() => lines.map((l) => Array.from(l)), [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = cps.reduce((n, l) => n + l.length, 0);
  const [chars, setChars] = useState(reduced ? total : 0);
  const doneCharsRef = useRef(reduced ? total : 0);
  doneCharsRef.current = chars;
  useEffect(() => {
    setChars(reduced ? total : 0);
    if (reduced) return;
    // updater 内で clearInterval しない (updater は純粋であるべき — レビュー指摘)。
    // 打ち終わったら interval 自体を止める
    const id = setInterval(() => {
      if (doneCharsRef.current >= total) {
        clearInterval(id);
        return;
      }
      setChars((c) => Math.min(total, c + 1));
    }, 22);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lines は joined で代表する
  }, [joined, total, reduced]);
  // 全文表示し終えたら onDone を content ごとに一度だけ通知
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const firedRef = useRef('');
  useEffect(() => {
    if (total > 0 && chars >= total && firedRef.current !== joined) {
      firedRef.current = joined;
      onDoneRef.current?.();
    }
  }, [chars, total, joined]);
  let used = 0;
  return (
    // タップで残りを即時全文 (セリフウィンドウと同じ「タップ = スキップ」作法)
    <div onClick={() => setChars(total)}>
      {cps.map((cp, i) => {
        const visible = Math.max(0, Math.min(cp.length, chars - used));
        used += cp.length;
        return (
          <div key={i}>
            {/* SR には全文を渡し、タイプ途中表示は aria-hidden (汎用要素の
                aria-label は多くの SR が無視する — レビュー指摘) */}
            <span style={SR_ONLY}>{lines[i]}</span>
            <span aria-hidden>{cp.slice(0, visible).join('')}</span>
            {/* 高さを先に確保 (行が出るたびにコマンド段が下へずれるのを防ぐ) */}
            {visible === 0 && <span aria-hidden>&nbsp;</span>}
          </div>
        );
      })}
    </div>
  );
}

/** visually-hidden (スクリーンリーダーにだけ全文を渡す) */
const SR_ONLY: CSSProperties = {
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
