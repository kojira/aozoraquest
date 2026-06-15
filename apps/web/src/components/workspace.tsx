/**
 * アプリ全体マルチカラムの workspace shell (docs/16-multicolumn.md)。
 *
 * `/` の index route として表示され、カラム構成をレンダリングする。
 * カラムの追加 (ColumnPicker) / 並べ替え (← →) / 削除 / 直リンクコピーが
 * でき、変更は saveAppColumns で localStorage に永続化される
 * (= ユーザーが編集して初めて保存される。未編集なら read-time 計算のまま。
 *  board カラムの inner は保存対象外で、常に /board での編集が正)。
 *
 * 各カラムは ColumnView (ヘッダー + 縦スクロールする body) で包み、
 * body 要素を ColumnScrollContext で配って内部の VirtualFeed が
 * 「カラム内スクロール」モードで動けるようにする。
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
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
  type AppColumnKind,
} from '@/lib/app-columns';
import { urlForColumn } from '@/lib/column-router';
import { publishVisibleColumn } from '@/lib/visible-column';
import { ColumnScrollContext } from '@/components/column-scroll-context';
import { ColumnContent } from '@/components/column-content';
import { ColumnPicker } from '@/components/column-picker';
import { refreshQuestIndex } from '@/lib/quest-index-cache';
import { invalidateProfile } from '@/lib/profile-cache';

/** picker の表示位置: 'end' = 末尾タイル、数値 = そのカラムの直右 */
type PickerAnchor = number | 'end' | null;

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

  const [pickerAnchor, setPickerAnchor] = useState<PickerAnchor>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // 各カラムの「更新世代」。bump すると ColumnContent の key が変わり remount
  // → mount 時に各カラムがネットワークから取り直す (= リフレッシュ)。
  // 明示更新なので先頭に戻る挙動は自然 (pull-to-refresh / ↻ ボタンとして妥当)。
  const [refreshNonce, setRefreshNonce] = useState<Record<string, number>>({});

  // モバイル全幅カラムでは「次カラムの peek」を出さない代わりに、横スクロールの
  // 端 (左右にまだカラムがあるか) を検知して ▶ / ◀ のスワイプヒントを出す。
  // swiped = 一度でも横スワイプしたら ▶ の点滅を止める。粒度は workspace 全体で
  // セッション中 1 回きり (= 「このアプリは横送りできる」を学べば十分なので、
  // カラムごとには点滅し直さない)。静かな常駐 (is-idle) には切り替わる。
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });
  const [swiped, setSwiped] = useState(false);

  /** kind ごとのモジュールキャッシュを無効化する (remount だけでは
   *  取り直さない quest index / profile を真に fresh にするため)。 */
  function bustColumnCache(col: AppColumn) {
    if (col.kind === 'board') void refreshQuestIndex();
    if (col.kind === 'profile' && col.param) invalidateProfile(col.param);
  }

  /** 1 カラムをリフレッシュする */
  function refreshColumn(col: AppColumn) {
    bustColumnCache(col);
    setRefreshNonce((m) => ({ ...m, [col.id]: (m[col.id] ?? 0) + 1 }));
  }

  /** 全カラムをまとめてリフレッシュする */
  function refreshAll(cols: AppColumn[]) {
    for (const c of cols) bustColumnCache(c);
    setRefreshNonce((m) => {
      const next = { ...m };
      for (const c of cols) next[c.id] = (next[c.id] ?? 0) + 1;
      return next;
    });
  }

  // いま主に見えているカラムの kind を footer-nav に伝える
  // (モバイル横スワイプで現在位置が分かるように)。
  // deps はカラム数のみ (= observe 対象の増減時だけ再構築。param 変更等の
  // 頻繁な columns 参照変化で IO を作り直して active がチラつくのを防ぐ)。
  const columnCount = columns?.length ?? 0;
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        // 最も大きく見えているカラムを採用
        let best: { kind: AppColumnKind; ratio: number } | null = null;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const kind = (e.target as HTMLElement).dataset.columnKind as AppColumnKind | undefined;
          if (!kind) continue;
          if (!best || e.intersectionRatio > best.ratio) best = { kind, ratio: e.intersectionRatio };
        }
        if (best) publishVisibleColumn(best.kind);
      },
      { root: scroller, threshold: [0.5] },
    );
    for (const el of scroller.querySelectorAll('[data-column-kind]')) io.observe(el);
    return () => io.disconnect();
    // workspace 自体が unmount される (= `/` 離脱) ときだけ null に戻す。
    // 再構築のたびに null を publish するとタブが一瞬チラつくため分離。
  }, [columnCount]);

  // PC で横スワイプ (トラックパッド) したとき、カーソルがカラム本体
  // (縦スクロールコンテナ) の上にあると横方向が本体に吸われて「引っかかる」。
  // 横優勢のホイールジェスチャを明示的に workspace スクローラへ流す。
  // 縦優勢 (deltaY) はそのまま = カラム内縦スクロールを妨げない。
  // 縦ホイールしかないマウスの横移動は別途スクロールバーで。
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // 縦優勢は無視
      // 横優勢: 親を横スクロールして本体への吸われを防ぐ
      scroller.scrollLeft += e.deltaX;
      e.preventDefault();
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  // 横スクロールの端を追跡し、左右にまだカラムがあるかでスワイプヒントを出し分ける。
  // 初回の横スワイプで swiped を立て、▶ の点滅を静める。
  // deps はカラム数 (= 端の判定が変わる構成変化) のみ。リサイズは ResizeObserver で拾う。
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      const { scrollLeft, clientWidth } = scroller;
      const atStart = scrollLeft <= 1;
      // 「右にまだ "カラム" がある」= 末尾の追加タイル (data-column-kind を持たない)
      // を除いた、最後のコンテンツカラムの右端を越えていないか。追加タイルを対象に
      // 入れると最終コンテンツ列でも ▶ が消えず誤誘導するため除外する。
      const contentCols = scroller.querySelectorAll<HTMLElement>('[data-column-kind]');
      const last = contentCols[contentCols.length - 1];
      const lastRight = last ? last.offsetLeft + last.offsetWidth : scroller.scrollWidth;
      const atEnd = scrollLeft + clientWidth >= lastRight - 1;
      setEdges((prev) => (prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd }));
    };
    const onScroll = () => { setSwiped(true); update(); };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [columnCount]);

  // `/` 離脱時に可視 kind をクリアする (active 残留防止)
  useEffect(() => () => publishVisibleColumn(null), []);

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

  /** カラムの部分更新 (検索カラムの param 追従などに使う)。
   *  onPatch は対象カラムの id に束縛されるため、kind を跨ぐ patch は
   *  構造上発生しない (dispatcher 参照)。 */
  function patchColumn(id: string, patch: Partial<AppColumn>) {
    edit((cols) => cols.map((c) => (c.id === id ? ({ ...c, ...patch } as AppColumn) : c)));
  }

  /** anchor 位置にカラムを挿入する */
  function insertColumn(col: AppColumn, anchor: PickerAnchor) {
    edit((cols) => {
      if (anchor === 'end' || anchor === null) return [...cols, col];
      const next = [...cols];
      next.splice(anchor + 1, 0, col);
      return next;
    });
    setPickerAnchor(null);
  }

  const picker = (
    <section className="workspace-column workspace-column-add">
      <div className="workspace-column-body">
        <ColumnPicker
          signedIn={signedIn}
          onAdd={(col) => insertColumn(col, pickerAnchor)}
          onClose={() => setPickerAnchor(null)}
        />
      </div>
    </section>
  );

  return (
    <div data-workspace="1">
      <div className="workspace-columns" ref={scrollerRef}>
        {(columns ?? []).map((col, i) => (
          <Fragment key={col.id}>
            <ColumnView
              column={col}
              canMoveLeft={i > 0}
              canMoveRight={i < (columns?.length ?? 0) - 1}
              onMoveLeft={() => edit((cols) => moveColumnLeft(cols, col.id))}
              onMoveRight={() => edit((cols) => moveColumnRight(cols, col.id))}
              onRemove={() => edit((cols) => removeColumn(cols, col.id))}
              onAddRight={() => setPickerAnchor(i)}
              onRefresh={() => refreshColumn(col)}
              onRefreshAll={() => refreshAll(columns ?? [])}
            >
              <ColumnContent
                key={refreshNonce[col.id] ?? 0}
                column={col}
                onPatch={(patch) => patchColumn(col.id, patch)}
              />
            </ColumnView>
            {/* 「右にカラムを追加」: そのカラムの直右に picker を出す
                (モバイルで末尾までスワイプしなくても追加できる副導線) */}
            {pickerAnchor === i && picker}
          </Fragment>
        ))}

        {pickerAnchor === 'end' ? (
          picker
        ) : (
          <section className="workspace-column workspace-column-add">
            <div className="workspace-column-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
                <button type="button" onClick={() => setPickerAnchor('end')}>＋ カラムを追加</button>
                <button
                  type="button"
                  className="secondary"
                  style={{ fontSize: '0.8em' }}
                  onClick={() => {
                    if (confirm('カラム構成を初期状態に戻しますか?\n(追加したカラムや並び順の変更は消えます)')) {
                      setColumns(resetAppColumns(signedIn));
                    }
                  }}
                >
                  初期構成に戻す
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* スワイプヒント (モバイル全幅カラム用)。左右にまだコンテンツカラムがあるときだけ
          出す純粋な視覚マーカー (pointer-events:none。タップ送りはしない = スワイプで
          送れるため冗長 + 本文右端のタップ誤爆を防ぐ)。▶ は初回スワイプまで点滅して
          「横に送れる」を知らせ、以後は静かな常駐に。PC では枠と自由スクロールで自明
          なので CSS で非表示。 */}
      {!edges.atStart && (
        <span className="workspace-swipe-hint left is-idle" aria-hidden="true">◀</span>
      )}
      {!edges.atEnd && (
        <span className={`workspace-swipe-hint right${swiped ? ' is-idle' : ''}`} aria-hidden="true">▶</span>
      )}
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
  onAddRight: () => void;
  onRefresh: () => void;
  onRefreshAll: () => void;
  children: ReactNode;
}

function ColumnView({ column, canMoveLeft, canMoveRight, onMoveLeft, onMoveRight, onRemove, onAddRight, onRefresh, onRefreshAll, children }: ColumnViewProps) {
  // body 要素を state で持つ (callback ref)。要素の出現が props 変化として
  // 子に伝わり、VirtualFeed がカラム内スクロールへ自然に切り替わる。
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // 押下フィードバック (↻ を一瞬回す) 用
  const [spinning, setSpinning] = useState(false);
  function triggerRefresh() {
    onRefresh();
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
  }
  // モバイル pull-to-refresh (カラム body を最上部から下に引くと更新)
  const pull = usePullToRefresh(bodyEl, triggerRefresh);

  // home / bar は専用 URL を持たない (urlForColumn が '/' を返す) ので
  // 直リンク項目を出さない
  const linkUrl = urlForColumn(column);
  const hasDirectLink = linkUrl !== '/';

  async function copyLink() {
    const url = `${location.origin}${linkUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => { setCopied(false); setMenuOpen(false); }, 1200);
    } catch {
      prompt('このカラムの URL:', url);
      setMenuOpen(false);
    }
  }

  function confirmRemove() {
    if (confirm(`「${appColumnTitle(column)}」カラムを削除しますか?`)) {
      onRemove();
    }
    setMenuOpen(false);
  }

  return (
    <section className="workspace-column" data-column-kind={column.kind}>
      <header className="workspace-column-header">
        <span className="workspace-column-title">{appColumnTitle(column)}</span>
        <button
          type="button"
          className={`workspace-column-refresh-btn${spinning ? ' is-spinning' : ''}`}
          aria-label={`${appColumnTitle(column)}を更新`}
          title="このカラムを更新"
          onClick={triggerRefresh}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          className="workspace-column-menu-btn"
          aria-label="カラム操作メニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
      </header>
      {menuOpen && (
        <div className="workspace-column-menu">
          <button type="button" disabled={!canMoveLeft} onClick={() => { onMoveLeft(); setMenuOpen(false); }}>← 左へ移動</button>
          <button type="button" disabled={!canMoveRight} onClick={() => { onMoveRight(); setMenuOpen(false); }}>→ 右へ移動</button>
          <button type="button" onClick={() => { onAddRight(); setMenuOpen(false); }}>＋ 右にカラムを追加</button>
          {/* 単一カラム時は「すべて」= 自カラムでラベルと実体が一致しないので隠す */}
          {(canMoveLeft || canMoveRight) && (
            <button type="button" onClick={() => { onRefreshAll(); setMenuOpen(false); }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4em' }}><RefreshIcon /> すべてのカラムを更新</span>
            </button>
          )}
          {hasDirectLink && (
            <button type="button" onClick={copyLink}>
              {copied ? 'コピーしました ✓' : 'このカラムの直リンクをコピー'}
            </button>
          )}
          <button type="button" onClick={confirmRemove}>✕ カラムを削除</button>
          <button type="button" className="secondary" onClick={() => setMenuOpen(false)}>閉じる</button>
        </div>
      )}
      <div className="workspace-column-body" ref={setBodyEl}>
        {pull.offset > 0 && (
          <div className="workspace-pull-indicator" style={{ height: pull.offset }}>
            <span className={pull.armed ? 'armed' : ''}>
              {pull.armed ? '離して更新' : '引いて更新'}
            </span>
          </div>
        )}
        <ColumnScrollContext.Provider value={bodyEl}>
          {children}
        </ColumnScrollContext.Provider>
      </div>
    </section>
  );
}

/** カレンダーの ↻ / すべて更新ボタンで使う回転矢印アイコン (絵文字不使用)。 */
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M13.7 1.8V5h-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

interface PullState {
  offset: number;
  armed: boolean;
}

/**
 * モバイル pull-to-refresh。スクロール最上部 (scrollTop===0) から下に引いた
 * ときだけ反応し、閾値を超えて指を離したら onRefresh を呼ぶ。
 * 通常の縦スクロールを邪魔しないよう、最上部かつ下方向のときだけ engage する。
 */
function usePullToRefresh(el: HTMLElement | null, onRefresh: () => void): PullState {
  const [state, setState] = useState<PullState>({ offset: 0, armed: false });
  const startY = useRef<number | null>(null);
  const startX = useRef<number>(0);
  const lockedAxis = useRef<'none' | 'vertical' | 'horizontal'>('none');
  const pulling = useRef(false);
  const armedRef = useRef(false);
  // onRefresh は毎 render で identity が変わるので ref 越しに最新を読む
  // (effect を毎回貼り直さないため)。
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const THRESHOLD = 64;
  const MAX = 96;

  useEffect(() => {
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0]!.clientY;
        startX.current = e.touches[0]!.clientX;
        lockedAxis.current = 'none';
        pulling.current = false;
      } else {
        startY.current = null;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0]!.clientY - startY.current;
      const dx = e.touches[0]!.clientX - startX.current;
      // 軸ロック: 最初に優勢な方向を決め、横優勢ならカラム間スワイプとして
      // pull を一切発火させない (scroll-snap の横送りを妨げない)。
      if (lockedAxis.current === 'none' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        lockedAxis.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (lockedAxis.current === 'horizontal') return;
      if (dy <= 0) {
        if (pulling.current) {
          pulling.current = false;
          armedRef.current = false;
          setState({ offset: 0, armed: false });
        }
        return;
      }
      pulling.current = true;
      const offset = Math.min(MAX, dy * 0.5); // ゴム的に減衰
      const armed = offset >= THRESHOLD;
      armedRef.current = armed;
      setState({ offset, armed });
      if (e.cancelable) e.preventDefault(); // pull 中はネイティブスクロール抑止
    };
    const end = () => {
      if (pulling.current && armedRef.current) onRefreshRef.current();
      pulling.current = false;
      armedRef.current = false;
      startY.current = null;
      setState({ offset: 0, armed: false });
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [el]);

  return state;
}
