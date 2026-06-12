/**
 * アプリ全体マルチカラム (workspace) のカラム設定 (docs/16-multicolumn.md)。
 *
 * カラム種類 (AppColumnKind):
 *  - home          : 自分のフォロー TL
 *  - bar           : ブルスコ酒場 (= 共鳴 TL、aozoraquest 利用者の集い)
 *  - notifications : 自分の通知
 *  - search        : 検索結果 (param = query)
 *  - board         : 依頼クエスト掲示板 (内側に BoardInner の sub column)
 *  - profile       : 特定プロフィール (param = handle)
 *
 * 既存の board 内マルチカラム (board-columns.ts) は `board` カラムの
 * inner として包含される二段構造。
 *
 * 設定は localStorage に保存。モバイルは横スワイプ (scroll-snap)、
 * デスクトップは横並びで表示する。
 */

import type { Archetype } from '@aozoraquest/core';

export type AppColumnKind = 'home' | 'bar' | 'notifications' | 'search' | 'board' | 'profile';

/** board カラム内側のサブカラム (旧 board-columns.ts の Column と同形) */
export interface BoardInner {
  kind: 'open' | 'mine' | 'applied' | 'tag' | 'job' | 'issuer';
  param?: string;
}

export type ColumnOpts =
  | { kind: 'search'; mode?: 'posts' | 'users' }
  | { kind: 'profile'; section?: 'posts' | 'portfolio' }
  | { kind: 'board'; inner?: BoardInner[] };

export interface AppColumn {
  id: string;
  kind: AppColumnKind;
  /** kind 別の主パラメータ (search = query, profile = handle) */
  param?: string;
  /** kind 別の追加オプション */
  opts?: ColumnOpts;
  /** ヘッダー表示の上書き。未設定なら kind+param から推定。 */
  title?: string;
}

const KEY = 'aozoraquest:appColumns:v1';
/** 旧 board 内マルチカラムの保存キー (マイグレーション元) */
const LEGACY_BOARD_KEY = 'aozoraquest:boardColumns:v1';

const SIGNED_IN_DEFAULT: ReadonlyArray<Omit<AppColumn, 'id'>> = [
  { kind: 'home', title: 'ホーム' },
  { kind: 'bar', title: 'BAR ブルスコ' },
  { kind: 'notifications', title: '通知' },
  { kind: 'board', title: 'クエスト掲示板' },
];

const SIGNED_OUT_DEFAULT: ReadonlyArray<Omit<AppColumn, 'id'>> = [
  { kind: 'board', title: 'クエスト掲示板' },
];

export function defaultColumns(signedIn: boolean): AppColumn[] {
  const base = signedIn ? SIGNED_IN_DEFAULT : SIGNED_OUT_DEFAULT;
  return base.map(c => ({ ...c, id: makeColumnId() }));
}

export function loadAppColumns(signedIn: boolean): AppColumn[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // 初回: 旧 boardColumns:v1 があれば board カラムの inner として取り込む
      const migrated = migrateLegacyBoardColumns(signedIn);
      if (migrated) return migrated;
      return defaultColumns(signedIn);
    }
    const parsed = JSON.parse(raw) as AppColumn[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultColumns(signedIn);
    const valid = parsed.filter(isValidAppColumn);
    if (valid.length === 0) return defaultColumns(signedIn);
    return valid;
  } catch {
    return defaultColumns(signedIn);
  }
}

export function saveAppColumns(columns: AppColumn[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(columns));
  } catch {/* no-op */}
}

export function resetAppColumns(signedIn: boolean): AppColumn[] {
  const cols = defaultColumns(signedIn);
  saveAppColumns(cols);
  return cols;
}

export function makeColumnId(): string {
  return `col-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

export function makeAppColumn(kind: AppColumnKind, param?: string, opts?: ColumnOpts, title?: string): AppColumn {
  const col: AppColumn = { id: makeColumnId(), kind };
  if (param !== undefined) col.param = param;
  if (opts !== undefined) col.opts = opts;
  if (title !== undefined) col.title = title;
  return col;
}

// ─── 並べ替え / 削除 (MVP は矢印ボタンのみ、DnD なし) ──────

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
  return true;
}

export function isValidBoardInner(v: unknown): v is BoardInner {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return BOARD_INNER_KINDS.includes(obj.kind as BoardInner['kind']);
}

// ─── 旧 boardColumns:v1 からのマイグレーション ──────────

/** 旧 board 内マルチカラムの保存があれば、デフォルト構成の board カラムの
 *  inner として埋め込んだ構成を返して保存する。なければ null。 */
function migrateLegacyBoardColumns(signedIn: boolean): AppColumn[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_BOARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Array<{ kind?: unknown; param?: unknown }>;
    if (!Array.isArray(parsed)) return null;
    const inner: BoardInner[] = [];
    for (const item of parsed) {
      if (isValidBoardInner(item)) {
        const bi: BoardInner = { kind: item.kind as BoardInner['kind'] };
        if (typeof item.param === 'string') bi.param = item.param;
        inner.push(bi);
      }
    }
    const cols = defaultColumns(signedIn);
    if (inner.length > 0) {
      const board = cols.find(c => c.kind === 'board');
      if (board) board.opts = { kind: 'board', inner };
    }
    saveAppColumns(cols);
    return cols;
  } catch {
    return null;
  }
}

/** 16 ジョブの選択肢 (board inner の job filter で使う) */
export const JOB_OPTIONS: Archetype[] = [
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'artist',
  'captain', 'miko', 'ninja', 'performer',
];
