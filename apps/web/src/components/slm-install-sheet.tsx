import { useState } from 'react';
import { checkSlmStorage } from '@/lib/slm-install';

/** 端末の空きが足りない時の文言 (確認シートと、儀式中に書けなかった時の精霊タブで同じ文を出す)。 */
export const SLM_STORAGE_FULL_MESSAGE = '端末の空きが足りないため、ブルスコンを呼び出せませんでした。';

/**
 * 召喚の儀式の前に出す確認シート (D-SLM-CARD-001 §2)。ブルスコン (約 660MB) を受け取るかを聞く。
 * [呼び出して始める] で空き容量を確かめ、足りれば onAccept。足りなければ文言を出し、[とじる] で onDecline と同じ扱いにする。
 */
export function SlmInstallSheet({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const [state, setState] = useState<'ask' | 'checking' | 'full'>('ask');

  const accept = async () => {
    setState('checking');
    const plan = await checkSlmStorage().catch(() => 'install-then-drop-sarashina' as const);
    if (plan === 'not-enough') setState('full');
    else onAccept();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ブルスコンを呼び出す"
      style={{ position: 'fixed', inset: 0, zIndex: 210, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div className="dq-window" style={{ width: 'min(100vw, 480px)', padding: '1.1em 1.2em 1.4em', borderRadius: '12px 12px 0 0' }}>
        {state === 'full' ? (
          <>
            <p style={{ margin: 0, lineHeight: 1.7 }}>{SLM_STORAGE_FULL_MESSAGE}</p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.1em' }}>
              <button type="button" onClick={onDecline}>とじる</button>
            </div>
          </>
        ) : (
          <>
            <p style={{ margin: 0, lineHeight: 1.7 }}>
              この端末にブルスコンを呼び出します（約660MB）。カードを引く・投稿を訳すのに使います。Wi-Fi でのダウンロードをおすすめします。
            </p>
            <div style={{ display: 'flex', gap: '0.6em', justifyContent: 'center', marginTop: '1.1em', flexWrap: 'wrap' }}>
              <button type="button" onClick={onDecline} disabled={state === 'checking'}>今はやめる</button>
              <button
                type="button"
                onClick={() => void accept()}
                disabled={state === 'checking'}
                style={{ background: 'var(--color-pill-bg)', border: '3px solid var(--color-pill-border)', color: 'var(--color-fg)' }}
              >
                呼び出して始める
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
