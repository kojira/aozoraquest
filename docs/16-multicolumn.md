# 16 - アプリ全体マルチカラム (workspace)

## 概要

aozoraquest の UI を「縦 1 列の冒険手帳」から **TweetDeck 風のマルチカラム (workspace)** に拡張する。デスクトップでは「ホーム TL / BAR ブルスコ / 通知 / クエスト掲示板 / プロフィール / 検索結果」を自由に並べて見られ、モバイルでは横スワイプ (scroll-snap) でカラム間を移動する。

`docs/15-user-quest.md` Phase 3 で実装した「board 内マルチカラム」は、本書のアーキテクチャでは **`board` カラムの内側のサブカラム (BoardInner)** に位置づけ直される。

メタファー: **カラムが手帳 1 ページ、workspace は手帳の見開き**。各カラムは DQ ウィンドウ (3px 白枠 + 四隅装飾) で、`.content` の大枠 (二重枠) は workspace モードでは透明化する。

## 確定要件

1. **カラム種類は 6 種** (MVP):
   - `home` — 自分のフォロー TL
   - `bar` — **BAR ブルスコ** (= 共鳴 TL を「aozoraquest 利用者が集う酒場」のメタファーで独立カラム化)
   - `notifications` — 自分の通知
   - `search` — 検索結果 (param = query, mode = posts | users)
   - `board` — 依頼クエスト掲示板 (内側に `BoardInner` のサブカラム)
   - `profile` — 特定プロフィール (param = handle, 複数同時表示可)
2. **モバイルも横スワイプ** (CSS `scroll-snap-type: x mandatory`、1 スワイプ = 1 カラム送り)
3. **feature flag なし**。各 PR で「壊れない状態」を維持しながら段階導入する

## アーキテクチャ: 「Workspace as default route」

- ルートパス `/` の index route が **Workspace** (`apps/web/src/components/workspace.tsx`)
- Workspace は `loadAppColumns()` で読んだカラム構成をレンダリングし、各列が `ColumnContent` (kind 別 dispatcher) を描画する
- **既存 URL (`/profile/:handle`, `/search?q=`, `/notifications` 等) は従来ページとして維持**。直リンク・シェア・SEO は壊れない。表示本体のコンポーネントを route と カラムで共用する (後述)

### route と カラムの共用パターン

各 route から表示本体を named export で切り出し、route は thin wrapper として残す:

| route | 切り出したコンポーネント | カラムでの使い方 |
|---|---|---|
| (旧 home.tsx → 削除) | `HomeColumn` / `BarColumn` (column-content/) | そのまま |
| notifications.tsx | `NotificationsFeed` | そのまま |
| search.tsx | `SearchPanel({ syncUrl, initialQuery, initialMode })` | syncUrl=false で URL 非同期 |
| profile.tsx | `ProfileView({ actor })` | column.param を渡す |
| board.tsx | (PR 4 で `BoardPanel` 化予定) | BoardInner を渡す |

**スクロールの自動切替**: 表示本体は `useColumnScrollEl()` (column-scroll-context.ts) で自分のスクロール親を取得して `VirtualFeed` の `scrollParent` に渡す。workspace 内ではカラムの `column-body` 要素、workspace 外 (= 従来ページ) では null = window スクロール。**route 側の挙動は無変更で済む**のがこの設計の利点。

## データモデル: `app-columns.ts`

```ts
export type AppColumnKind = 'home' | 'bar' | 'notifications' | 'search' | 'board' | 'profile';

export type AppColumn =
  | (ColumnBase & { kind: 'home' })
  | (ColumnBase & { kind: 'bar' })
  | (ColumnBase & { kind: 'notifications' })
  | (ColumnBase & { kind: 'search'; param?: string; mode?: 'posts' | 'users' })
  | (ColumnBase & { kind: 'board'; inner?: BoardInner[] })
  | (ColumnBase & { kind: 'profile'; param?: string; section?: 'posts' | 'portfolio' });
```

- **kind ごとの discriminated union** (フィールドを平坦に持つ)。kind とフィールドの不整合が型レベルで起きない
- board は `inner: BoardInner[]` で旧 board 内サブカラム (open / mine / applied / tag / job / issuer) を包含する二段構造

### 永続化: localStorage + read-time 変換

- 保存キー: `aozoraquest:appColumns:v1`
- **保存はユーザーの明示操作 (saveAppColumns) のみ**。default 構成や変換結果を機械的に保存しない
- 保存がない限り `loadAppColumns(signedIn)` は毎回「default 構成 + 旧 `boardColumns:v1` の read-time 変換」を計算するため、サインイン状態の変化や旧キーの更新に常に追従する (= セッション解決前に board だけの構成が固定化される事故を構造的に防ぐ)
- デフォルト構成: サインイン済み `[home, bar, notifications, board]`、未サインイン `[board]`
- PDS 同期 (`app.aozoraquest.layout`) は将来の opt-in 機能 (Phase 4+)

## レイアウト CSS

```css
/* モバイル: 1 スワイプ = 1 カラム送り。次のカラムの端をチラ見せ */
.workspace-columns {
  display: flex; flex-direction: row; overflow-x: auto;
  scroll-snap-type: x mandatory; overscroll-behavior-x: contain;
}
.workspace-column {
  flex: 0 0 calc(100% - 1.6em);
  scroll-snap-align: start; scroll-snap-stop: always;
  height: calc(100dvh - 10.5em);   /* 実測 CSS 変数化は PR 5 */
}
.workspace-column-body { overflow-y: auto; overscroll-behavior: contain; }

@media (min-width: 768px) {
  .workspace-column { flex: 0 0 340px; }
  .workspace-columns { scroll-snap-type: none; }  /* PC は自由スクロール */
}
```

- 幅緩和 (`max-width: min(100vw - 1.5em, 1480px)`) は **768px から** 適用 (1100px 始まりだとタブレット縦持ちで破綻)
- workspace モードでは `.content` の大枠を透明化 (`:has([data-workspace="1"])`)

## VirtualFeed の dual-mode

- `scrollParent?: HTMLElement | null` を optional prop で受ける。未指定 = window スクロール (後方互換)
- **RefObject ではなく要素そのもの** を渡す (commit タイミング / memo 化での stale 参照を構造ごと排除)。利用側は `useState` + callback ref で要素を管理
- container モードの scrollMargin は「リスト先頭の container 内オフセット」を実測 (ResizeObserver で上部コンテンツの高さ変化に追従)

## データ取得の重複防止

| キャッシュ | 対象 | 方式 |
|---|---|---|
| `lib/use-self-diagnosis.ts` | 自分の診断 (home / bar が共用) | module-level キャッシュ + 購読 + settle フラグ。`refreshSelfDiagnosis()` で全購読者に伝播 |
| `lib/profile-cache.ts` | `agent.getProfile` (複数 profile カラム) | actor 単位の inflight dedup + 30s TTL メモリ |
| `lib/handle-cache.ts` (既存) | did → handle 解決 | 24h localStorage |
| `useQuestIndex` (PR 4 予定) | fetchQuestIndex | inflight + メモリ |

bar カラムの `buildResonanceTimeline` (最大 30 DID × 2 req) は **自分の診断が settle してから 1 回だけ** 実行し、epoch ガードで古い実行の後着上書きを防ぐ。

## 実装ロードマップ (5 PR)

| PR | 内容 | 状態 |
|---|---|---|
| 1 (#32) | VirtualFeed dual-mode + AppColumn データモデル | done |
| 2 (#33) | Workspace shell + home / bar カラム + モバイル横スワイプ基本形 | done |
| 3 (#34) | notifications / search / profile カラム化 + profile-cache | done |
| 4 | board カラム (BoardPanel 化) + ColumnPicker (追加 UI) + 矢印並べ替え + column-router (URL ↔ AppColumn) + 「このカラムへの直リンク」 | 予定 |
| 5 | snap 磨き込み + footer-nav 連動 (scrollIntoView / IntersectionObserver) + `--shell-chrome-height` 実測 + 通知既読の可視判定 + e2e + docs 整合 | 予定 |

## 既知の制約 / 検討事項 (PR 4-5 で対応)

- **通知の既読化**: NotificationsFeed はカラムとして mount された時点で `updateNotificationsSeen` を発火する。workspace の default 構成に notifications が入っているため、`/` を開くだけで未読バッジが消える。可視判定 (IntersectionObserver) ベースへの変更を PR 5 で検討
- **search カラムの param 追従**: SearchPanel は initialQuery を useState 初期値でしか読まないため、PR 4 のカラム編集で param が変わったときは `key` で remount させる
- **column-content → routes の import 方向**: PR 4 で board を取り込むと循環のリスクがあるため、panel 群を components/ 配下へ移すことを検討
- **DM カラム / List カラム**: Bluesky の DM・List API 調査が別途必要 (Phase 5+)
- **drag & drop 並べ替え**: MVP は矢印ボタンのみ。要望次第で dnd-kit

## 関連ドキュメント

- `docs/15-user-quest.md` — 依頼クエスト機能 (§UI 設計 E の board 内マルチカラムは本書の BoardInner に統合)
- `DESIGN.md` — DQ ウィンドウ様式・カラーパレット (workspace のカラムは `.dq-window` 様式を踏襲)
- `docs/07-ui-design.md` — UI 全般
