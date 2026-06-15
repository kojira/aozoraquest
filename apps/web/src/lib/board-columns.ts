/**
 * @deprecated アプリ全体マルチカラム化 (docs/16-multicolumn.md) に伴い、
 * この board 限定カラム設定は app-columns.ts の `board` カラム内
 * `BoardInner` に統合される。旧保存キー `boardColumns:v1` は
 * app-columns.ts 側で片方向マイグレーションされる。
 * board.tsx が workspace の ColumnContent に包含されるまで (PR 4) は
 * 本ファイルが現役。新規コードからは参照しないこと。
 *
 * 依頼クエスト掲示板のマルチカラム設定 (docs/15-user-quest.md §UI 設計 E)。
 *
 * カラム種類:
 *  - open     : 全体の募集中
 *  - mine     : 自分が出した
 *  - applied  : 自分が応募した
 *  - tag      : 特定タグ (param = タグ名)
 *  - job      : 特定 targetJob (param = archetype id)
 *  - issuer   : 特定発行者 DID (param = did)
 *
 * 設定は localStorage に保存。デスクトップ (>= 768px) で並列、
 * モバイルでは縦並びでスクロール (Phase 3 MVP)。
 */

import type { Archetype } from '@aozoraquest/core';

export type ColumnKind = 'open' | 'assigned' | 'mine' | 'applied' | 'tag' | 'job' | 'issuer';

export interface Column {
  id: string;
  kind: ColumnKind;
  /** tag=タグ名、job=archetype id、issuer=did。kind により意味が変わる。 */
  param?: string;
  /** ヘッダー表示。未設定なら kind+param から推定。 */
  title?: string;
}

const KEY = 'aozoraquest:boardColumns:v1';
/** 「受託中」カラム導入の 1 回限りマイグレーション済みフラグ。 */
const ASSIGNED_MIGRATED_KEY = 'aozoraquest:boardColumns:assignedMigrated';

const DEFAULT_COLUMNS: Column[] = [
  { id: 'col-open', kind: 'open', title: '募集中' },
  // 受託したクエストを見失わないよう既定に追加 (受託者の完了報告導線)
  { id: 'col-assigned', kind: 'assigned', title: '受託中' },
  { id: 'col-mine', kind: 'mine', title: '自分が出した' },
  { id: 'col-applied', kind: 'applied', title: '自分が応募した' },
];

export function loadColumns(): Column[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_COLUMNS];
    const parsed = JSON.parse(raw) as Column[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_COLUMNS];
    return migrateAssigned(parsed.filter(isValidColumn));
  } catch {
    return [...DEFAULT_COLUMNS];
  }
}

/**
 * 既存ユーザー (localStorage に旧 [open, mine] 等を保存済み) に「受託中」カラムを 1 回だけ
 * 注入する。これが無いと DEFAULT_COLUMNS 拡張が新規ユーザーにしか届かず、受託者導線の修正が
 * 本番の既存ユーザーに反映されない。保存もするので workspace の board inner (同じ key を
 * read-time 参照) にも効く。ユーザーが後で意図的に削除したら、フラグ済みなので再注入しない。
 */
function migrateAssigned(cols: Column[]): Column[] {
  try {
    if (localStorage.getItem(ASSIGNED_MIGRATED_KEY)) return cols;
    localStorage.setItem(ASSIGNED_MIGRATED_KEY, '1');
  } catch {
    return cols;
  }
  if (cols.some(c => c.kind === 'assigned')) return cols;
  const next: Column[] = [];
  for (const c of cols) {
    next.push(c);
    if (c.kind === 'open') next.push({ id: 'col-assigned', kind: 'assigned', title: '受託中' });
  }
  if (!next.some(c => c.kind === 'assigned')) next.unshift({ id: 'col-assigned', kind: 'assigned', title: '受託中' });
  if (!next.some(c => c.kind === 'applied')) next.push({ id: 'col-applied', kind: 'applied', title: '自分が応募した' });
  saveColumns(next);
  return next;
}

export function saveColumns(columns: Column[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(columns));
  } catch {/* no-op */}
}

export function resetColumns(): Column[] {
  saveColumns([...DEFAULT_COLUMNS]);
  return [...DEFAULT_COLUMNS];
}

export function makeColumn(kind: ColumnKind, param?: string, title?: string): Column {
  const id = `col-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
  const col: Column = { id, kind };
  if (param !== undefined) col.param = param;
  if (title !== undefined) col.title = title;
  return col;
}

export function defaultTitleFor(c: Column): string {
  if (c.title) return c.title;
  switch (c.kind) {
    case 'open':    return '募集中';
    case 'assigned': return '受託中';
    case 'mine':    return '自分が出した';
    case 'applied': return '自分が応募した';
    case 'tag':     return `#${c.param ?? ''}`;
    case 'job':     return `求めるジョブ: ${c.param ?? ''}`;
    case 'issuer':  return `発行者別`;
  }
}

function isValidColumn(c: unknown): c is Column {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  if (typeof obj.id !== 'string') return false;
  const kinds: ColumnKind[] = ['open', 'assigned', 'mine', 'applied', 'tag', 'job', 'issuer'];
  if (!kinds.includes(obj.kind as ColumnKind)) return false;
  return true;
}

/** archetype の knownValues は core から。チップ選択肢に使う。 */
export const JOB_OPTIONS: Archetype[] = [
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'artist',
  'captain', 'miko', 'ninja', 'performer',
];
