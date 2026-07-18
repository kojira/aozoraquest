import { useEffect, useRef } from 'react';

/**
 * あおぞらワールドの DQ 風コマンドメニュー (オーナー要望 2026-07-18
 * 「マップ上の自分を押すとマップの上にドラクエ風メニューがひらいてコマンドを
 * 選択できるように」)。
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

export function WorldMenu({ commands, onClose }: { commands: readonly WorldMenuCommand[]; onClose: () => void }) {
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
      style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 8, background: 'rgba(0,0,0,0.25)' }}
    >
      <div
        className="dq-window"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 8, marginBottom: 4, minWidth: 180, maxWidth: '90%' }}
      >
        <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4, textAlign: 'center' }}>コマンド</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
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
                padding: '0.6em 0.4em',
                fontSize: '0.9em',
                touchAction: 'manipulation',
                opacity: c.disabled ? 0.5 : 1,
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
