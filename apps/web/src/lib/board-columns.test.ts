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

beforeEach(() => {
  localStorage.clear();
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
