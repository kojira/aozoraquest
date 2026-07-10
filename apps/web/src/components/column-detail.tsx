import { createContext, lazy, Suspense, useContext, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { didFromUri, postUri, rkeyFromUri } from '@/lib/uri';
import { ColumnScrollContext } from '@/components/column-scroll-context';

/**
 * カラム内ドリルダウン (TweetDeck 型)。投稿/プロフィールをタップすると、そのカラムの
 * body の上にオーバーレイで詳細を重ねる。フィードは下でマウントされたまま (= スクロール
 * 位置が失われない)。スタックは react-router の location.state (`colStack`) に持ち、URL は
 * `/` のまま履歴に積む → Workspace は再マウントされず、端末バックで pop できる。
 */

export type ColumnDetailEntry =
  | { kind: 'post'; uri: string; handle: string; rkey: string }
  | { kind: 'profile'; actor: string };

interface StackItem {
  columnId: string;
  entry: ColumnDetailEntry;
}

export interface ColumnNav {
  /** uri (at-uri) と (分かれば) handle から投稿詳細を開く。 */
  openPost: (uri: string, handle?: string | null) => void;
  /** handle/DID + rkey から投稿詳細を開く (bsky.app リンク等、uri を持たない経路用)。 */
  openPostByParts: (actor: string, rkey: string) => void;
  openProfile: (actor: string) => void;
}

/** あおぞら内部パス (/profile/<actor>[/post/<rkey>]) を対応する openPost/openProfile に振り分ける。
 *  対応形なら true。呼び出し側は true のとき既定リンク挙動を preventDefault する。 */
export function pushInternalPath(nav: ColumnNav, path: string): boolean {
  const parts = path.split('/').filter((s) => s.length > 0);
  if (parts[0] !== 'profile' || !parts[1]) return false;
  const actor = safeDecode(parts[1]);
  if (parts.length === 2) {
    nav.openProfile(actor);
    return true;
  }
  if (parts.length === 4 && parts[2] === 'post') {
    nav.openPostByParts(actor, safeDecode(parts[3]!));
    return true;
  }
  return false;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const ColumnNavContext = createContext<ColumnNav | null>(null);

/** カラム内に居れば nav を返す。居なければ null (呼び出し側は route 遷移にフォールバック)。 */
export function useColumnNav(): ColumnNav | null {
  return useContext(ColumnNavContext);
}

function getStack(location: Location): StackItem[] {
  const s = (location.state as { colStack?: StackItem[] } | null)?.colStack;
  return Array.isArray(s) ? s : [];
}

/** このカラム (columnId) の最上位の詳細エントリ。無ければ null (= フィード表示)。 */
export function useColumnDetailTop(columnId: string): ColumnDetailEntry | null {
  const location = useLocation();
  const stack = getStack(location);
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.columnId === columnId) return stack[i]!.entry;
  }
  return null;
}

/** columnId 用の ColumnNav を作る (ColumnView が Provider に渡す)。
 *  location は毎 navigation で identity が変わるので ref 経由で最新を読む。これで nav の
 *  identity を (navigate/columnId が安定な限り) 固定でき、どこかの drill 毎に全カラムの
 *  投稿行が無駄に再レンダーするのを防ぐ。push は click 時に最新 stack を読む。 */
export function useColumnNavValue(columnId: string): ColumnNav {
  const navigate = useNavigate();
  const location = useLocation();
  const locRef = useRef(location);
  locRef.current = location;

  return useMemo<ColumnNav>(() => {
    const push = (entry: ColumnDetailEntry) => {
      const loc = locRef.current;
      const prev = getStack(loc);
      // URL は現在のまま (workspace の '/') で history に 1 つ積む。state に stack を載せる。
      navigate(loc.pathname + loc.search, {
        state: { ...(loc.state as object | null), colStack: [...prev, { columnId, entry }] },
      });
    };
    return {
      openPost: (uri, handle) =>
        push({ kind: 'post', uri, rkey: rkeyFromUri(uri), handle: handle || didFromUri(uri) }),
      openPostByParts: (actor, rkey) =>
        push({ kind: 'post', uri: postUri(actor, rkey), rkey, handle: actor }),
      openProfile: (actor) => push({ kind: 'profile', actor }),
    };
  }, [navigate, columnId]);
}

export const ColumnNavProvider = ColumnNavContext.Provider;

// post-thread は post-text → column-detail の循環を避けるため lazy 取得する。
const PostThread = lazy(() => import('./post-thread').then((m) => ({ default: m.PostThread })));
const ProfileView = lazy(() => import('@/routes/profile').then((m) => ({ default: m.ProfileView })));

const DETAIL_FALLBACK = (
  <div style={{ padding: '1em', fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</div>
);

/** カラムを覆う詳細オーバーレイ (戻るヘッダ + 本体)。onBack は history を 1 つ pop する。
 *  本体は独自スクロールなので、内側の VirtualFeed (ProfileView 等) 用に ColumnScrollContext を
 *  自前の body 要素で上書きする。 */
export function ColumnDetailView({
  entry,
  onBack,
  parentTitle,
}: {
  entry: ColumnDetailEntry;
  onBack: () => void;
  parentTitle?: string;
}) {
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  return (
    <div className="workspace-column-detail">
      <div className="workspace-column-detail-header">
        <button type="button" className="workspace-column-detail-back" onClick={onBack} aria-label="戻る">
          ← 戻る
        </button>
        {parentTitle && <span className="workspace-column-detail-parent">{parentTitle}</span>}
      </div>
      <div className="workspace-column-detail-body" ref={setBodyEl}>
        <ColumnScrollContext.Provider value={bodyEl}>
          <Suspense fallback={DETAIL_FALLBACK}>
            {entry.kind === 'post' ? (
              <PostThread handle={entry.handle} rkey={entry.rkey} uri={entry.uri} />
            ) : (
              <ProfileView actor={entry.actor} />
            )}
          </Suspense>
        </ColumnScrollContext.Provider>
      </div>
    </div>
  );
}
