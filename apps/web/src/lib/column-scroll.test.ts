import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { columnScrollKey, readColumnScroll, writeColumnScroll } from './column-scroll';
import type { AppColumn } from './app-columns';

// vitest 環境は 'node' (DOM 無し) なので sessionStorage を最小ポリフィル (prefs.test と同様)。
beforeAll(() => {
  if (typeof globalThis.sessionStorage === 'undefined') {
    const store = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }
});

const col = (c: Partial<AppColumn> & { kind: AppColumn['kind'] }): AppColumn =>
  ({ id: 'x', ...c }) as AppColumn;

describe('columnScrollKey', () => {
  it('kind ごとに安定キー (id に依存しない)', () => {
    expect(columnScrollKey(col({ kind: 'home' }))).toBe('home');
    expect(columnScrollKey(col({ kind: 'bar' }))).toBe('bar');
    expect(columnScrollKey(col({ kind: 'notifications' }))).toBe('notifications');
    expect(columnScrollKey(col({ kind: 'board' }))).toBe('board');
  });

  it('search / profile は param を含めて区別', () => {
    expect(columnScrollKey(col({ kind: 'search', param: 'foo', mode: 'posts' }))).toBe('search:posts:foo');
    expect(columnScrollKey(col({ kind: 'profile', param: 'a.example', section: 'posts' }))).toBe(
      'profile:posts:a.example',
    );
  });

  it('同じ id でも kind が違えば別キー / 違う id でも同じ kind なら同キー', () => {
    expect(columnScrollKey(col({ id: 'A', kind: 'home' }))).toBe(columnScrollKey(col({ id: 'B', kind: 'home' })));
  });
});

describe('read/writeColumnScroll', () => {
  beforeEach(() => sessionStorage.clear());

  it('保存した値を読み戻す', () => {
    writeColumnScroll('home', 1234);
    expect(readColumnScroll('home')).toBe(1234);
  });

  it('丸めて保存', () => {
    writeColumnScroll('home', 1234.7);
    expect(readColumnScroll('home')).toBe(1235);
  });

  it('0 以下は保存せず削除 (先頭 = 保存なし扱い)', () => {
    writeColumnScroll('home', 500);
    writeColumnScroll('home', 0);
    expect(readColumnScroll('home')).toBe(0);
    expect(sessionStorage.getItem('aozoraquest:scroll:home')).toBeNull();
  });

  it('未保存キーは 0', () => {
    expect(readColumnScroll('never')).toBe(0);
  });
});
