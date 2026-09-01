import type { ReactNode } from 'react';

/**
 * **保存済みレコードを読み込むまで、エディタの全操作を止める** (#603)。
 *
 * `useAuthoredWorld` は読み込み完了で一覧を現物から取り直す (reset)。その前に
 * 始めた編集は reset で黙って消えるので、完了までは入力欄もボタンも触らせない。
 * `fieldset[disabled]` は中の input / select / button を一括で無効にする
 * (エディタごとに `disabled={!loaded}` を配って回らない)。リンクは効いたまま。
 */
export function AuthoredWorldGate({ loaded, children }: { loaded: boolean; children: ReactNode }) {
  return (
    <fieldset className="admin-gate" disabled={!loaded}>
      {!loaded && <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', margin: '0 0 0.4em' }}>保存済みの定義を読み込み中…</p>}
      {children}
    </fieldset>
  );
}
