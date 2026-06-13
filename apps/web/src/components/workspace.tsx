/**
 * アプリ全体マルチカラムの workspace shell (docs/16-multicolumn.md)。
 *
 * `/` の index route として表示され、loadAppColumns() で読んだカラム構成を
 * 並べる。各カラムは ColumnView (ヘッダー + 縦スクロールする body) で包み、
 * body 要素を ColumnScrollContext で配って内部の VirtualFeed が
 * 「カラム内スクロール」モードで動けるようにする。
 *
 * レイアウトはモバイル = 縦積み、768px 以上 = 横並び (styles.css の
 * .workspace-columns)。横スワイプ (scroll-snap) は PR 5 で追加する。
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { loadAppColumns, appColumnTitle, type AppColumn } from '@/lib/app-columns';
import { ColumnContent } from '@/components/column-content';

/** カラムの縦スクロール要素。VirtualFeed の scrollParent に渡す。
 *  workspace 外 (= 従来の単一ページ) では null = window スクロール。 */
const ColumnScrollContext = createContext<HTMLElement | null>(null);

export function useColumnScrollEl(): HTMLElement | null {
  return useContext(ColumnScrollContext);
}

export function Workspace() {
  const session = useSession();
  // 保存がなければ「default 構成 + 旧 board 設定の read-time 変換」が返る。
  // - サインイン状態の確定を待ってから読む (loading 中に false で読むと
  //   1 render だけ board 構成が出てチラつくため)
  // - default 構成は呼ぶたび新しい id を生成するので、useMemo で安定化する
  //   (毎 render 再計算すると React key が変わり全カラムが remount してしまう)
  const signedIn = session.status === 'signed-in';
  const cols = useMemo<AppColumn[] | null>(
    () => (session.status === 'loading' ? null : loadAppColumns(signedIn)),
    [session.status, signedIn],
  );

  if (session.status === 'loading') {
    return <p>準備しています...</p>;
  }

  if (session.status === 'signed-out') {
    // 未サインインの landing (旧 home.tsx から移設)。board カラムが PR 4 で
    // 動くようになったら、landing + board カラムの併置に変える。
    return (
      <div>
        <h2>あおぞらくえすと</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          Bluesky で読み書きしながら、あなたの気質をゆっくり見つけていくアプリ。
        </p>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログインして始める</button></Link>
      </div>
    );
  }

  return (
    <div data-workspace="1">
      <div className="workspace-columns">
        {(cols ?? []).map((col) => (
          <ColumnView key={col.id} column={col}>
            <ColumnContent column={col} />
          </ColumnView>
        ))}
      </div>
    </div>
  );
}

function ColumnView({ column, children }: { column: AppColumn; children: ReactNode }) {
  // body 要素を state で持つ (callback ref)。要素の出現が props 変化として
  // 子に伝わり、VirtualFeed がカラム内スクロールへ自然に切り替わる。
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  return (
    <section className="workspace-column" data-column-kind={column.kind}>
      <header className="workspace-column-header">
        <span className="workspace-column-title">{appColumnTitle(column)}</span>
      </header>
      <div className="workspace-column-body" ref={setBodyEl}>
        <ColumnScrollContext.Provider value={bodyEl}>
          {children}
        </ColumnScrollContext.Provider>
      </div>
    </section>
  );
}
