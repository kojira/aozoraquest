/**
 * アプリ全体マルチカラム (workspace) のカラム設定 (docs/16-multicolumn.md)。
 *
 * カラム種類 (AppColumnKind):
 *  - home          : 自分のフォロー TL
 *  - bar           : ブルスコ酒場 (= 共鳴 TL、aozoraquest 利用者の集い)
 *  - notifications : 自分の通知
 *  - search        : 検索結果 (query / mode)
 *  - board         : 依頼クエスト掲示板 (内側に BoardInner の sub column)
 *  - profile       : 特定プロフィール (handle / section)
 *
 * AppColumn は kind ごとの discriminated union (= kind とフィールドの
 * 不整合が型レベルで起きない)。既存の board 内マルチカラム
 * (board-columns.ts) は `board` カラムの inner として包含される二段構造。
 *
 * 永続化は localStorage。**保存はユーザーの明示操作時のみ**
 * (saveAppColumns 経由)。保存がない限り loadAppColumns は毎回
 * 「default 構成 + 旧 boardColumns:v1 の read-time 変換」を返すので、
 * サインイン状態の変化や旧キーの更新 (PR 4 まで board.tsx が書く) に
 * 常に追従する。
 */

import type { Archetype } from '@aozoraquest/core';

export type AppColumnKind = 'home' | 'bar' | 'notifications' | 'search' | 'board' | 'profile';

/** board カラム内側のサブカラム (旧 board-columns.ts の Column と同形)。
 *  id は持たない (= 永続データとしては種類 + param が本体)。PR 4 で
 *  board ColumnContent が React key 用の id を mount 時に付与して
 *  橋渡しする (削除・並べ替えは index ベースで書き戻す)。 */
export interface BoardInner {
  kind: 'open' | 'mine' | 'applied' | 'tag' | 'job' | 'issuer';
  param?: string;
}

interface ColumnBase {
  id: string;
  /** ヘッダー表示の上書き。未設定なら kind+param から推定。 */
  title?: string;
}

export type AppColumn =
  | (ColumnBase & { kind: 'home' })
  | (ColumnBase & { kind: 'bar' })
  | (ColumnBase & { kind: 'notifications' })
  | (ColumnBase & { kind: 'search'; param?: string; mode?: 'posts' | 'users' })
  | (ColumnBase & { kind: 'board'; inner?: BoardInner[] })
  | (ColumnBase & { kind: 'profile'; param?: string; section?: 'posts' | 'portfolio' });

const KEY = 'aozoraquest:appColumns:v1';
/** 旧 board 内マルチカラムの保存キー (read-time 変換元)。
 *  PR 4 で board.tsx が ColumnContent に包含されるまでは board.tsx が
 *  このキーを読み書きし続けるため、消さない・上書きしない。 */
const LEGACY_BOARD_KEY = 'aozoraquest:boardColumns:v1';

export function defaultColumns(signedIn: boolean): AppColumn[] {
  const cols: AppColumn[] = signedIn
    ? [
        { id: makeColumnId(), kind: 'home' },
        { id: makeColumnId(), kind: 'notifications' },
        { id: makeColumnId(), kind: 'bar' },
        { id: makeColumnId(), kind: 'board' },
      ]
    : [{ id: makeColumnId(), kind: 'board' }];
  return injectBoardInner(cols);
}

export function loadAppColumns(signedIn: boolean): AppColumn[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultColumns(signedIn);
    const parsed = JSON.parse(raw) as AppColumn[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultColumns(signedIn);
    const valid = parsed.filter(isValidAppColumn);
    if (valid.length === 0) return defaultColumns(signedIn);
    // 保存済み構成にも board の inner を read-time で注入する
    // (inner の正は常に旧 boardColumns:v1 = /board ページでの編集)
    return injectBoardInner(valid);
  } catch {
    return defaultColumns(signedIn);
  }
}

/** board カラムの inner は保存しない。inner の唯一の正は
 *  旧 boardColumns:v1 (= /board ページでの編集) で、load 時に毎回
 *  read-time で注入する。これにより検索カラムの param 保存などで
 *  appColumns:v1 が確定した後も /board での inner 編集が workspace に
 *  反映され続ける。 */
function injectBoardInner(cols: AppColumn[]): AppColumn[] {
  const inner = readLegacyBoardInner();
  return cols.map((c) => {
    if (c.kind !== 'board') return c;
    if (inner.length > 0) return { ...c, inner };
    const { inner: _drop, ...rest } = c;
    return rest as AppColumn;
  });
}

/** 保存はユーザーの明示操作 (カラム追加・削除・並べ替え・検索 param 更新)
 *  時のみ呼ぶこと。default 構成や read-time 変換結果を機械的に保存しては
 *  いけない (サインイン前に board だけの構成が固定される事故のもと)。
 *  board カラムの inner は strip して保存する (正は boardColumns:v1)。 */
export function saveAppColumns(columns: AppColumn[]): void {
  try {
    const stripped = columns.map((c) => {
      if (c.kind !== 'board') return c;
      const { inner: _drop, ...rest } = c;
      return rest as AppColumn;
    });
    localStorage.setItem(KEY, JSON.stringify(stripped));
  } catch {/* no-op */}
}

/** 保存済み構成を破棄して default に戻す (= 以後また read-time 計算に従う) */
export function resetAppColumns(signedIn: boolean): AppColumn[] {
  try {
    localStorage.removeItem(KEY);
  } catch {/* no-op */}
  return defaultColumns(signedIn);
}

export function makeColumnId(): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `col-${rand}-${Date.now().toString(36)}`;
}

export function makeAppColumn<K extends AppColumnKind>(
  kind: K,
  fields?: Omit<Extract<AppColumn, { kind: K }>, 'id' | 'kind'>,
): AppColumn {
  return { id: makeColumnId(), kind, ...fields } as AppColumn;
}

// ─── 並べ替え / 削除 (MVP は矢印ボタンのみ、DnD なし) ──────
// いずれも入力配列を mutate しない (新しい配列を返す)。

export function moveColumnLeft(columns: AppColumn[], id: string): AppColumn[] {
  const i = columns.findIndex(c => c.id === id);
  if (i <= 0) return columns;
  const next = [...columns];
  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
  return next;
}

export function moveColumnRight(columns: AppColumn[], id: string): AppColumn[] {
  const i = columns.findIndex(c => c.id === id);
  if (i < 0 || i >= columns.length - 1) return columns;
  const next = [...columns];
  [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
  return next;
}

export function removeColumn(columns: AppColumn[], id: string): AppColumn[] {
  return columns.filter(c => c.id !== id);
}

// ─── 表示名 ────────────────────────────────────────────

export function appColumnTitle(c: AppColumn): string {
  if (c.title) return c.title;
  switch (c.kind) {
    case 'home':          return 'ホーム';
    case 'bar':           return 'BAR ブルスコ';
    case 'notifications': return '通知';
    case 'search':        return c.param ? `検索: ${c.param}` : '検索';
    case 'board':         return 'クエスト掲示板';
    case 'profile':       return c.param ? `@${c.param}` : 'プロフィール';
  }
}

// ─── validation ───────────────────────────────────────

const APP_KINDS: AppColumnKind[] = ['home', 'bar', 'notifications', 'search', 'board', 'profile'];
const BOARD_INNER_KINDS: BoardInner['kind'][] = ['open', 'mine', 'applied', 'tag', 'job', 'issuer'];

export function isValidAppColumn(c: unknown): c is AppColumn {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  if (!APP_KINDS.includes(obj.kind as AppColumnKind)) return false;
  // kind 別フィールドの軽い検証 (壊れた値は load 時に丸ごと除外する)
  if (obj.kind === 'board' && obj.inner !== undefined) {
    if (!Array.isArray(obj.inner) || !obj.inner.every(isValidBoardInner)) return false;
  }
  return true;
}

export function isValidBoardInner(v: unknown): v is BoardInner {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return BOARD_INNER_KINDS.includes(obj.kind as BoardInner['kind']);
}

// ─── 旧 boardColumns:v1 の read-time 変換 ───────────────

/** 旧 board 内マルチカラムの保存を BoardInner[] として読む。
 *  保存はしない (read-time 変換)。旧キーが board.tsx (PR 4 まで現役) に
 *  更新されても、appColumns:v1 未保存の限り常に最新が反映される。 */
function readLegacyBoardInner(): BoardInner[] {
  try {
    const raw = localStorage.getItem(LEGACY_BOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ kind?: unknown; param?: unknown }>;
    if (!Array.isArray(parsed)) return [];
    const inner: BoardInner[] = [];
    for (const item of parsed) {
      if (isValidBoardInner(item)) {
        const bi: BoardInner = { kind: item.kind as BoardInner['kind'] };
        if (typeof item.param === 'string') bi.param = item.param;
        inner.push(bi);
      }
    }
    return inner;
  } catch {
    return [];
  }
}

/** 16 ジョブの選択肢 (board inner の job filter で使う)。
 *  board-columns.ts にも同名 export があるが、あちらは /board フル表示
 *  ページ専用 (inner 編集の正)。workspace 側はここを正本として参照する。
 *  将来 inner 編集を workspace に統合したら board-columns.ts ごと削除する。 */
export const JOB_OPTIONS: Archetype[] = [
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'artist',
  'captain', 'miko', 'ninja', 'performer',
];
