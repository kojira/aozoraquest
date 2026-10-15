import { useState } from 'react';

/**
 * **ベータの区切りで LV が 1 に戻ったことを一度だけ伝える** (#534)。
 *
 * 経験値の記録先をサーバーに一本化するにあたり、全員が Lv1 から再スタートした。
 * 何の説明も無いとアプリを開いた瞬間に「LV30 → LV1」だけが見え、
 * **通信障害と本物のリセットが見分けられない**。誤解を残さないために出す。
 *
 * 出すのは**実際にレベルを失った人だけ** (ベータ期間の記録がある人)。新規ユーザーには
 * 意味のない情報なので出さない。閉じたら二度と出さない (localStorage)。
 */
const KEY = 'aq.betaResetSeen';

export function BetaResetNotice({ hadLegacyLevel }: { hadLegacyLevel: boolean }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (!hadLegacyLevel || dismissed) return null;

  const close = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* quota 等は無視 (次回また出るだけ) */ }
    setDismissed(true);
  };

  return (
    <div className="dq-window" style={{ padding: '0.7em 0.9em', fontSize: '0.85em', lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}>
        けいけんちの きろくを あらためた。
        <br />
        ぼうけんしゃたちの レベルは <strong>1 に もどっている</strong>。
      </p>
      <p style={{ margin: '0.4em 0 0', color: 'var(--color-muted)', fontSize: '0.92em' }}>
        これまでの あゆみは じぶんのページに きざまれている。
      </p>
      <div style={{ textAlign: 'right', marginTop: '0.5em' }}>
        <button onClick={close} style={{ fontSize: '0.9em' }}>わかった</button>
      </div>
    </div>
  );
}
