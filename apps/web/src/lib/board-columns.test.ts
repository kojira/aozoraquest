import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  loadColumns,
  saveColumns,
  resetColumns,
  makeColumn,
  defaultTitleFor,
} from './board-columns';

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    };
  }
});

const ASSIGNED_MIGRATED_KEY = 'aozoraquest:boardColumns:assignedMigrated';

beforeEach(() => {
  localStorage.clear();
  // 既存テストは「受託中」移行と無関係なので、既定で移行済みにして干渉を避ける。
  // 移行ロジック自体は専用 describe でフラグを外して検証する。
  localStorage.setItem(ASSIGNED_MIGRATED_KEY, '1');
});

describe('loadColumns / saveColumns', () => {
  it('初期状態で default 4 カラム (募集中 + 受託中 + 自分が出した + 自分が応募)', () => {
    const cols = loadColumns();
    expect(cols).toHaveLength(4);
    expect(cols.map(c => c.kind)).toEqual(['open', 'assigned', 'mine', 'applied']);
  });

  it('save → load で同じ内容が戻る', () => {
    const next = [
      makeColumn('open'),
      makeColumn('tag', 'illust'),
      makeColumn('job', 'sage'),
    ];
    saveColumns(next);
    const loaded = loadColumns();
    expect(loaded.map(c => ({ kind: c.kind, param: c.param }))).toEqual([
      { kind: 'open' },
      { kind: 'tag', param: 'illust' },
      { kind: 'job', param: 'sage' },
    ]);
  });

  it('壊れた JSON は default に fallback', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', 'not json {');
    const cols = loadColumns();
    expect(cols).toHaveLength(4);
  });

  it('空配列は default に fallback (= UI 上「全消し」を許さない)', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', '[]');
    const cols = loadColumns();
    expect(cols).toHaveLength(4);
  });

  it('未知の kind は filter で除外する', () => {
    const data = [
      { id: 'a', kind: 'open' },
      { id: 'b', kind: 'unknown-kind' },
      { id: 'c', kind: 'tag', param: 'x' },
    ];
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify(data));
    const cols = loadColumns();
    expect(cols.map(c => c.kind)).toEqual(['open', 'tag']);
  });
});

describe('resetColumns', () => {
  it('default に戻して localStorage にも書き込む', () => {
    saveColumns([makeColumn('tag', 'foo')]);
    const cols = resetColumns();
    expect(cols).toHaveLength(4);
    const loaded = loadColumns();
    expect(loaded).toHaveLength(4);
  });
});

describe('既存ユーザーへの「受託中」マイグレーション', () => {
  it('旧 [open, mine] に open 直後で assigned を、末尾に applied を 1 回だけ注入し保存する', () => {
    localStorage.removeItem(ASSIGNED_MIGRATED_KEY); // 未移行の既存ユーザーを再現
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'a', kind: 'open' }, { id: 'b', kind: 'mine' },
    ]));
    const cols = loadColumns();
    expect(cols.map(c => c.kind)).toEqual(['open', 'assigned', 'mine', 'applied']);
    // 保存もされる (= workspace の board inner にも効く)
    expect((JSON.parse(localStorage.getItem('aozoraquest:boardColumns:v1')!) as { kind: string }[]).map(c => c.kind))
      .toEqual(['open', 'assigned', 'mine', 'applied']);
    // 2 回目はフラグ済みなので再注入しない (ユーザーが消しても戻らない)
    saveColumns([{ id: 'a', kind: 'open' }]);
    expect(loadColumns().map(c => c.kind)).toEqual(['open']);
  });

  it('既に assigned を持つ構成は変更しない', () => {
    localStorage.removeItem(ASSIGNED_MIGRATED_KEY);
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'a', kind: 'open' }, { id: 'x', kind: 'assigned' },
    ]));
    expect(loadColumns().map(c => c.kind)).toEqual(['open', 'assigned']);
  });
});

describe('makeColumn', () => {
  it('id がユニーク', () => {
    const a = makeColumn('open');
    const b = makeColumn('open');
    expect(a.id).not.toBe(b.id);
  });

  it('param 未指定なら undefined', () => {
    const c = makeColumn('open');
    expect(c.param).toBeUndefined();
  });
});

describe('defaultTitleFor', () => {
  it('title 明示があれば優先', () => {
    expect(defaultTitleFor({ id: '1', kind: 'open', title: 'カスタム' })).toBe('カスタム');
  });

  it('kind 別の自動 title', () => {
    expect(defaultTitleFor({ id: '1', kind: 'open' })).toBe('募集中');
    expect(defaultTitleFor({ id: '1', kind: 'mine' })).toBe('自分が出した');
    expect(defaultTitleFor({ id: '1', kind: 'applied' })).toBe('自分が応募した');
    expect(defaultTitleFor({ id: '1', kind: 'tag', param: 'illust' })).toBe('#illust');
    expect(defaultTitleFor({ id: '1', kind: 'job', param: 'sage' })).toBe('求めるジョブ: sage');
    expect(defaultTitleFor({ id: '1', kind: 'issuer', param: 'did:plc:x' })).toBe('発行者別');
  });
});
