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
  clampColumnWidth,
  COLUMN_MIN_WIDTH,
  COLUMN_MAX_WIDTH,
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
  it('サインイン済み: home / notifications / bar / board の 4 カラム', () => {
    const cols = defaultColumns(true);
    expect(cols.map(c => c.kind)).toEqual(['home', 'notifications', 'bar', 'board']);
  });

  it('未サインイン: board 1 カラムのみ', () => {
    const cols = defaultColumns(false);
    expect(cols.map(c => c.kind)).toEqual(['board']);
  });

  it('id は毎回ユニーク', () => {
    const a = defaultColumns(true);
    const b = defaultColumns(true);
    expect(a[0]!.id).not.toBe(b[0]!.id);
    // 同一呼び出し内の 4 カラムも互いにユニーク
    expect(new Set(a.map(c => c.id)).size).toBe(4);
  });
});

describe('loadAppColumns / saveAppColumns', () => {
  it('保存なし → default 構成 (localStorage への書き込みは発生しない)', () => {
    expect(loadAppColumns(true).map(c => c.kind)).toEqual(['home', 'notifications', 'bar', 'board']);
    expect(localStorage.getItem('aozoraquest:appColumns:v1')).toBeNull();
  });

  it('save → load で同じ内容が戻る', () => {
    const cols = [
      makeAppColumn('search', { param: 'illust', mode: 'posts' }),
      makeAppColumn('profile', { param: 'kojira.example', section: 'portfolio' }),
    ];
    saveAppColumns(cols);
    const loaded = loadAppColumns(true);
    expect(loaded.map(c => ({ kind: c.kind, param: 'param' in c ? c.param : undefined }))).toEqual([
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

describe('旧 boardColumns:v1 の read-time 変換', () => {
  it('旧 board カラム設定が board カラムの inner として読める', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'open' },
      { id: 'y', kind: 'tag', param: 'illust' },
    ]));
    const cols = loadAppColumns(true);
    const board = cols.find(c => c.kind === 'board')!;
    expect(board.kind === 'board' && board.inner).toEqual([
      { kind: 'open' },
      { kind: 'tag', param: 'illust' },
    ]);
  });

  it('変換結果は永続化されない (= read-time、appColumns:v1 は書かれない)', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([{ id: 'x', kind: 'open' }]));
    loadAppColumns(false);
    expect(localStorage.getItem('aozoraquest:appColumns:v1')).toBeNull();
  });

  it('★ 未サインインで読んだ後にサインインしても構成が固定されない', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([{ id: 'x', kind: 'mine' }]));
    // セッション解決前 (signedIn=false) に先に読まれるケース
    expect(loadAppColumns(false).map(c => c.kind)).toEqual(['board']);
    // サインイン後はフル構成に戻る (read-time なので固定化しない)
    expect(loadAppColumns(true).map(c => c.kind)).toEqual(['home', 'notifications', 'bar', 'board']);
  });

  it('★ 旧キーが後から更新されても次回 load に反映される (鮮度維持)', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([{ id: 'x', kind: 'open' }]));
    const first = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(first.kind === 'board' && first.inner).toEqual([{ kind: 'open' }]);

    // board.tsx (PR 4 まで現役) が旧キーを更新したと想定
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'open' },
      { id: 'z', kind: 'tag', param: 'art' },
    ]));
    const second = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(second.kind === 'board' && second.inner).toEqual([
      { kind: 'open' },
      { kind: 'tag', param: 'art' },
    ]);
  });

  it('旧設定に未知 kind が混ざっていても有効分だけ取り込む', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'nonsense' },
      { id: 'y', kind: 'mine' },
    ]));
    const board = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(board.kind === 'board' && board.inner).toEqual([{ kind: 'mine' }]);
  });

  it('旧設定が空配列 / 全 invalid なら inner なし', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', '[]');
    const a = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(a.kind === 'board' && a.inner).toBeUndefined();

    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([{ id: 'b', kind: 'bogus' }]));
    const b = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(b.kind === 'board' && b.inner).toBeUndefined();
  });

  it('旧設定が壊れた JSON でも default に fallback して落ちない', () => {
    localStorage.setItem('aozoraquest:boardColumns:v1', '{broken');
    expect(loadAppColumns(true)).toHaveLength(4);
  });

  it('保存済み appColumns:v1 があれば旧キーより優先される', () => {
    saveAppColumns([makeAppColumn('search', { param: 'q' })]);
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([{ id: 'x', kind: 'open' }]));
    expect(loadAppColumns(true).map(c => c.kind)).toEqual(['search']);
  });

  it('★ saveAppColumns は board の inner を保存しない (正は boardColumns:v1)', () => {
    saveAppColumns([makeAppColumn('board', { inner: [{ kind: 'open' }] })]);
    const raw = JSON.parse(localStorage.getItem('aozoraquest:appColumns:v1')!) as Array<Record<string, unknown>>;
    expect(raw[0]!.kind).toBe('board');
    expect(raw[0]!.inner).toBeUndefined();
  });

  it('★ 保存済み構成の load でも board の inner は read-time 注入される', () => {
    // ユーザーがカラム編集して保存済み (board は inner なしで保存される)
    saveAppColumns([makeAppColumn('board'), makeAppColumn('home')]);
    // その後 /board ページで inner を編集
    localStorage.setItem('aozoraquest:boardColumns:v1', JSON.stringify([
      { id: 'x', kind: 'tag', param: 'art' },
    ]));
    const board = loadAppColumns(true).find(c => c.kind === 'board')!;
    expect(board.kind === 'board' && board.inner).toEqual([{ kind: 'tag', param: 'art' }]);
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

  it('左へ移動 (入力配列は mutate しない)', () => {
    const input = cols3();
    const moved = moveColumnLeft(input, 'b');
    expect(moved.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(input.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('先頭はそれ以上左へ動かない', () => {
    expect(moveColumnLeft(cols3(), 'a').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('右へ移動 (入力配列は mutate しない)', () => {
    const input = cols3();
    const moved = moveColumnRight(input, 'b');
    expect(moved.map(c => c.id)).toEqual(['a', 'c', 'b']);
    expect(input.map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('末尾はそれ以上右へ動かない', () => {
    expect(moveColumnRight(cols3(), 'c').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('存在しない id は no-op', () => {
    expect(moveColumnLeft(cols3(), 'zz').map(c => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('削除 (入力配列は mutate しない)', () => {
    const input = cols3();
    const removed = removeColumn(input, 'b');
    expect(removed.map(c => c.id)).toEqual(['a', 'c']);
    expect(input).toHaveLength(3);
  });
});

describe('resetAppColumns', () => {
  it('保存済み構成を破棄して default に戻す', () => {
    saveAppColumns([makeAppColumn('search', { param: 'x' })]);
    const cols = resetAppColumns(true);
    expect(cols).toHaveLength(4);
    // key が消えるので以後は read-time 計算に従う
    expect(localStorage.getItem('aozoraquest:appColumns:v1')).toBeNull();
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
    expect(appColumnTitle({ id: '1', kind: 'profile' })).toBe('プロフィール');
  });
});

describe('isValidAppColumn', () => {
  it('id 欠落 / kind 不正を弾く', () => {
    expect(isValidAppColumn({ kind: 'home' })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'nope' })).toBe(false);
    expect(isValidAppColumn(null)).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'profile', param: 'h' })).toBe(true);
  });

  it('board の inner が壊れていたら弾く', () => {
    expect(isValidAppColumn({ id: 'a', kind: 'board', inner: [{ kind: 'open' }] })).toBe(true);
    expect(isValidAppColumn({ id: 'a', kind: 'board', inner: [{ kind: 'bogus' }] })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'board', inner: 'not-array' })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'board' })).toBe(true);
  });
});

describe('makeAppColumn (discriminated union)', () => {
  it('kind 別フィールドが平坦に入る', () => {
    const s = makeAppColumn('search', { param: 'q', mode: 'users' });
    expect(s).toMatchObject({ kind: 'search', param: 'q', mode: 'users' });
    const b = makeAppColumn('board', { inner: [{ kind: 'open' }] });
    expect(b).toMatchObject({ kind: 'board', inner: [{ kind: 'open' }] });
    const h = makeAppColumn('home');
    expect(h.kind).toBe('home');
    expect(h.id).toMatch(/^col-/);
  });
});

describe('clampColumnWidth', () => {
  it('範囲内はそのまま (四捨五入)', () => {
    expect(clampColumnWidth(340)).toBe(340);
    expect(clampColumnWidth(500.4)).toBe(500);
    expect(clampColumnWidth(500.6)).toBe(501);
  });
  it('下限・上限でクランプ', () => {
    expect(clampColumnWidth(COLUMN_MIN_WIDTH - 1)).toBe(COLUMN_MIN_WIDTH);
    expect(clampColumnWidth(0)).toBe(COLUMN_MIN_WIDTH);
    expect(clampColumnWidth(-9999)).toBe(COLUMN_MIN_WIDTH);
    expect(clampColumnWidth(COLUMN_MAX_WIDTH + 1)).toBe(COLUMN_MAX_WIDTH);
    expect(clampColumnWidth(99999)).toBe(COLUMN_MAX_WIDTH);
  });
});

describe('カラム幅 (width) の永続化と検証', () => {
  it('width 付きカラムが save→load で round-trip する', () => {
    const cols: AppColumn[] = [{ id: 'a', kind: 'home', width: 500 }];
    saveAppColumns(cols);
    const loaded = loadAppColumns(true);
    expect(loaded[0]).toMatchObject({ kind: 'home', width: 500 });
  });

  it('isValidAppColumn は有限数の width のみ許容、壊れた width は弾く', () => {
    expect(isValidAppColumn({ id: 'a', kind: 'home', width: 400 })).toBe(true);
    expect(isValidAppColumn({ id: 'a', kind: 'home' })).toBe(true); // width 無しも可
    expect(isValidAppColumn({ id: 'a', kind: 'home', width: 'abc' })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'home', width: NaN })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'home', width: Infinity })).toBe(false);
    expect(isValidAppColumn({ id: 'a', kind: 'home', width: null })).toBe(false);
  });

  it('壊れた width のカラムは load 時に除外される', () => {
    localStorage.setItem(
      'aozoraquest:appColumns:v1',
      JSON.stringify([{ id: 'a', kind: 'home', width: 'oops' }, { id: 'b', kind: 'bar', width: 400 }]),
    );
    const loaded = loadAppColumns(true);
    // 壊れた home は除外、正常な bar は残る
    expect(loaded.map(c => c.kind)).toEqual(['bar']);
    expect(loaded[0]).toMatchObject({ width: 400 });
  });
});
