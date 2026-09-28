import { useEffect, useRef } from 'react';
import { OVERLAY_Z } from './world-hud';

/**
 * あおぞらワールドの DQ 風コマンドメニュー。マップ上の自分を押すと開く。
 *
 * マップの relative コンテナ内に **操作オーバーレイ層 (z 3)** として重ねる
 * (docs/19「マップ上オーバーレイの層」)。背面の透明シートで外タップ = 閉じる
 * を受けつつ、仮想スティックには届かせない (メニュー表示中は歩かせない)。
 */

export interface WorldMenuCommand {
  key: string;
  label: string;
  /** 使えない状況 (例: 街の外で「なんでも屋」) はグレーアウト */
  disabled?: boolean;
  onSelect: () => void;
}

export function WorldMenu({ commands, questLines, onClose }: {
  commands: readonly WorldMenuCommand[];
  questLines: readonly string[];
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // 操作オーバーレイ層。inset:0 の透明シートで外タップ = 閉じる + スティック遮断
    <div
      role="dialog"
      aria-modal="true"
      aria-label="コマンド"
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', inset: 0, zIndex: OVERLAY_Z, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 8, background: 'rgba(0,0,0,0.25)' }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 8, marginBottom: 4, minWidth: 180, maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}
      >
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4, textAlign: 'center' }}>コマンド</div>
        <section aria-label="受注中の依頼" style={{ minHeight: 0, overflowY: 'auto', maxHeight: '40%', fontSize: '0.8em', marginBottom: 6, overflowWrap: 'anywhere' }}>
          <div>{questLines.length ? `受注中の依頼 ${questLines.length}件` : '受注中の依頼は ありません'}</div>
          {questLines.map((line, i) => <p key={i} style={{ margin: '0.4em 0' }}>{line}</p>)}
          {questLines.length > 0 && <>
            <p>同じ敵の依頼は、受注しているものすべてに数えます。</p>
            <p>所持品は ほかの依頼・どうぐ・制作と共通です。報告すると減ります。</p>
          </>}
        </section>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, flexShrink: 0 }}>
          {commands.map((c, i) => (
            <button
              key={c.key}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              disabled={c.disabled}
              onClick={() => {
                onClose();
                c.onSelect();
              }}
              style={{
                padding: '0.5em 1em',
                fontSize: '0.9em',
                textAlign: 'left',
                touchAction: 'manipulation',
                opacity: c.disabled ? 0.5 : 1,
              }}
            >
              {c.label}
            </button>
          ))}
          <button type="button" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
