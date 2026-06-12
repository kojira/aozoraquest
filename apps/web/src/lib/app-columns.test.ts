import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  loadAppColumns,
  saveAppColumns,
  resetAppColumns,
  defaultColumns,
  makeAppColumn,
  moveColumnLeft,
  moveColumnRight,
  removeColumn,
  appColumnTitle,
  isValidAppColumn,
  type AppColumn,
} from './app-columns';

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

describe('defaultColumns', () => {
  it('サインイン済み: home / bar / notifications / board の 4 カラム', () => {
    const cols = defaultColumns(true);
    expect(cols.map(c => c.kind)).toEqual(['home', 'bar', 'notifications', 'board']);
  });

  it('未サインイン: board 1 カラムのみ', () => {
    const cols = defaultColumns(false);
    expect(cols.map(c => c.kind)).toEqual(['board']);
  });

  it('id は毎回ユニーク', () => {
    const a = defaultColumns(true);
    const b = defaultColumns(true);
    expect(a[0]!.id).not.toBe(b[0]!.id);
  });
});

describe('loadAppColumns / saveAppColumns', () => {
  it('保存なし → default 構成', () => {
    expect(loadAppColumns(true).map(c => c.kind)).toEqual(['home', 'bar', 'notifications', 'board']);
  });

  it('save → load で同じ内容が戻る', () => {
    const cols = [
      makeAppColumn('search', 'illust', { kind: 'search', mode: 'posts' }),
      makeAppColumn('profile', 'kojira.example', { kind: 'profile', section: 'portfolio' }),
    ];
    saveAppColumns(cols);
    const loaded = loadAppColumns(true);
    expect(loaded.map(c => ({ kind: c.kind, param: c.param }))).toEqual([
      { kind: 'search', param: 'illust' },
      { kind: 'profile', param: 'kojira.example' },
    ]);
  });

  it('壊れた JSON は default に fallback', () => {
    localStorage.setItem('aozoraquest:appColumns:v1', 'not json {');
    expect(loadAppColumns(false).map(c => c.kind)).toEqual(['board']);
  });

  it('空配列は default に fallback', () => {
    localStorage.setItem('aozoraquest:appColumns:v1', '[]');
    expect(loadAppColumns(true)).toHaveLength(4);
  });

  it('未知 kind は filter で除外、全滅なら default', () => {
    localStorage.setItem('aozoraquest:appColumns:v1', JSON.stringify([
      { id: 'a', kind: 'home' },
      { id: 'b', kind: 'unknown-kind' },
    ]));
    expect(loadAppColumns(true).map(c => c.kind)).toEqual(['home']);

    localStorage.setItem('aozoraquest:appColumns:v1', JSON.stringify([
      { id: 'b', kind: 'unknown-kind' },
    ]));
    expect(loadAppColumns(false).map(c => c.kind)).toEqual(['board']);
  });
});

describe('旧 boardColumns:v1 マイグレーション', () => {
  it('旧 board カラム設定が board カラムの inner に埋め込まれる', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'open' },
      { id: 'y', kind: 'tag', param: 'illust' },
    ]));
    const cols = loadAppColumns(true);
    const board = cols.find(c => c.kind === 'board')!;
    expect(board.opts).toEqual({
      kind: 'board',
      inner: [{ kind: 'open' }, { kind: 'tag', param: 'illust' }],
    });
    // マイグレーション結果が永続化されている
    const reloaded = loadAppColumns(true);
    expect(reloaded.find(c => c.kind === 'board')!.opts).toEqual(board.opts);
  });

  it('旧設定に未知 kind が混ざっていても有効分だけ取り込む', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'nonsense' },
      { id: 'y', kind: 'mine' },
    ]));
    const cols = loadAppColumns(true);
    const board = cols.find(c => c.kind === 'board')!;
    expect(board.opts).toEqual({ kind: 'board', inner: [{ kind: 'mine' }] });
  });

  it('旧設定が壊れた JSON でも default に fallback して落ちない', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', '{broken');
    expect(loadAppColumns(true)).toHaveLength(4);
  });
});

describe('moveColumnLeft / moveColumnRight / removeColumn', () => {
  function cols3(): AppColumn[] {
    return [
      { id: 'a', kind: 'home' },
      { id: 'b', kind: 'notifications' },
      { id: 'c', kind: 'board' },
    ];
  }

  it('左へ移動', () => {
    expect(moveColumnLeft(cols3(), 'b').map(c => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('先頭はそれ以上左へ動かない', () => {
    expect(moveColumnLeft(cols3(), 'a').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('右へ移動', () => {
    expect(moveColumnRight(cols3(), 'b').map(c => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('末尾はそれ以上右へ動かない', () => {
    expect(moveColumnRight(cols3(), 'c').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('存在しない id は no-op', () => {
    expect(moveColumnLeft(cols3(), 'zz').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('削除', () => {
    expect(removeColumn(cols3(), 'b').map(c => c.id)).toEqual(['a', 'c']);
  });
});

describe('resetAppColumns', () => {
  it('default に戻して保存する', () => {
    saveAppColumns([makeAppColumn('search', 'x')]);
    const cols = resetAppColumns(true);
    expect(cols).toHaveLength(4);
    expect(loadAppColumns(true)).toHaveLength(4);
  });
});

describe('appColumnTitle', () => {
  it('title 明示があれば優先', () => {
    expect(appColumnTitle({ id: '1', kind: 'home', title: 'カスタム' })).toBe('カスタム');
  });

  it('kind 別の自動 title', () => {
    expect(appColumnTitle({ id: '1', kind: 'home' })).toBe('ホーム');
    expect(appColumnTitle({ id: '1', kind: 'bar' })).toBe('BAR ブルスコ');
    expect(appColumnTitle({ id: '1', kind: 'notifications' })).toBe('通知');
    expect(appColumnTitle({ id: '1', kind: 'search', param: 'foo' })).toBe('検索: foo');
    expect(appColumnTitle({ id: '1', kind: 'search' })).toBe('検索');
    expect(appColumnTitle({ id: '1', kind: 'board' })).toBe('クエスト掲示板');
    expect(appColumnTitle({ id: '1', kind: 'profile', param: 'kojira.example' })).toBe('@kojira.example');
  });
});

describe('isValidAppColumn', () => {
  it('id 欠落 / kind 不正を弾く', () => {
    expect(isValidAppColumn({ kind: 'home' })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'nope' })).toBe(false);
    expect(isValidAppColumn(null)).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'profile', param: 'h' })).toBe(true);
  });
});
