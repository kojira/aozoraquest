/**
 * アプリ全体マルチカラムの workspace shell (docs/16-multicolumn.md)。
 *
 * `/` の index route として表示され、カラム構成をレンダリングする。
 * カラムの追加 (ColumnPicker) / 並べ替え (← →) / 削除 / 直リンクコピーが
 * でき、変更は saveAppColumns で localStorage に永続化される
 * (= ユーザーが編集して初めて保存される。未編集なら read-time 計算のまま)。
 *
 * 各カラムは ColumnView (ヘッダー + 縦スクロールする body) で包み、
 * body 要素を ColumnScrollContext で配って内部の VirtualFeed が
 * 「カラム内スクロール」モードで動けるようにする。
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import {
  loadAppColumns,
  saveAppColumns,
  resetAppColumns,
  moveColumnLeft,
  moveColumnRight,
  removeColumn,
  appColumnTitle,
  type AppColumn,
} from '@/lib/app-columns';
import { urlForColumn } from '@/lib/column-router';
import { ColumnScrollContext } from '@/components/column-scroll-context';
import { ColumnContent } from '@/components/column-content';
import { ColumnPicker } from '@/components/column-picker';

export function Workspace() {
  const session = useSession();
  const signedIn = session.status === 'signed-in';

  // columns は編集可能な state。session 確定時に load する
  // (loading 中に読むと board 構成が 1 render チラつくため)。
  // load 結果は id を毎回生成するので、effect で 1 回だけ state に入れる。
  const [columns, setColumns] = useState<AppColumn[] | null>(null);
  useEffect(() => {
    if (session.status === 'loading') return;
    setColumns(loadAppColumns(signedIn));
  }, [session.status, signedIn]);

  const [pickerOpen, setPickerOpen] = useState(false);

  if (session.status === 'loading') {
    return <p>準備しています...</p>;
  }

  if (session.status === 'signed-out') {
    // 未サインインの landing。board カラム等は ColumnPicker で追加可能だが、
    // 初見の体験としては従来の導入文を出す。
    return (
      <div>
        <h2>あおぞらくえすと</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          Bluesky で読み書きしながら、あなたの気質をゆっくり見つけていくアプリ。
        </p>
        <Link to="/onboarding"><button style={{ marginTop: '1em' }}>ログインして始める</button></Link>
        <p style={{ marginTop: '1.5em', fontSize: '0.85em' }}>
          <Link to="/board">ログインせずにクエスト掲示板をのぞく →</Link>
        </p>
      </div>
    );
  }

  /** 編集操作: state 更新と同時に localStorage へ保存する */
  function edit(updater: (cols: AppColumn[]) => AppColumn[]) {
    setColumns((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (next !== prev) saveAppColumns(next);
      return next;
    });
  }

  /** カラムの部分更新 (検索カラムの param 追従などに使う) */
  function patchColumn(id: string, patch: Partial<AppColumn>) {
    edit((cols) => cols.map((c) => (c.id === id ? ({ ...c, ...patch } as AppColumn) : c)));
  }

  return (
    <div data-workspace="1">
      <div className="workspace-columns">
        {(columns ?? []).map((col, i) => (
          <ColumnView
            key={col.id}
            column={col}
            canMoveLeft={i > 0}
            canMoveRight={i < (columns?.length ?? 0) - 1}
            onMoveLeft={() => edit((cols) => moveColumnLeft(cols, col.id))}
            onMoveRight={() => edit((cols) => moveColumnRight(cols, col.id))}
            onRemove={() => edit((cols) => removeColumn(cols, col.id))}
          >
            <ColumnContent
              column={col}
              onPatch={(patch) => patchColumn(col.id, patch)}
            />
          </ColumnView>
        ))}

        <section className="workspace-column workspace-column-add">
          <div className="workspace-column-body">
            {pickerOpen ? (
              <ColumnPicker
                signedIn={signedIn}
                onAdd={(col) => {
                  edit((cols) => [...cols, col]);
                  setPickerOpen(false);
                }}
                onClose={() => setPickerOpen(false)}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
                <button type="button" onClick={() => setPickerOpen(true)}>＋ カラムを追加</button>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: '0.8em' }}
                  onClick={() => {
                    if (confirm('カラム構成を初期状態に戻しますか?')) {
                      setColumns(resetAppColumns(signedIn));
                    }
                  }}
                >
                  初期構成に戻す
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface ColumnViewProps {
  column: AppColumn;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
  children: ReactNode;
}

function ColumnView({ column, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onRemove, children }: ColumnViewProps) {
  // body 要素を state で持つ (callback ref)。要素の出現が props 変化として
  // 子に伝わり、VirtualFeed がカラム内スクロールへ自然に切り替わる。
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  async function copyLink() {
    const url = `${location.origin}${urlForColumn(column)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt('このカラムの URL:', url);
    }
    setMenuOpen(false);
  }

  return (
    <section className="workspace-column" data-column-kind={column.kind}>
      <header className="workspace-column-header">
        <span className="workspace-column-title">{appColumnTitle(column)}</span>
        <button
          type="button"
          className="workspace-column-menu-btn"
          aria-label="カラム操作メニュー"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
      </header>
      {menuOpen && (
        <div className="workspace-column-menu" role="menu">
          <button type="button" disabled={!canMoveLeft} onClick={() => { onMoveLeft(); setMenuOpen(false); }}>← 左へ移動</button>
          <button type="button" disabled={!canMoveRight} onClick={() => { onMoveRight(); setMenuOpen(false); }}>→ 右へ移動</button>
          <button type="button" onClick={copyLink}>このカラムの直リンクをコピー</button>
          <button type="button" onClick={() => { onRemove(); setMenuOpen(false); }}>✕ カラムを削除</button>
          <button type="button" className="secondary" onClick={() => setMenuOpen(false)}>閉じる</button>
        </div>
      )}
      <div className="workspace-column-body" ref={setBodyEl}>
        <ColumnScrollContext.Provider value={bodyEl}>
          {children}
        </ColumnScrollContext.Provider>
      </div>
    </section>
  );
}
