import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// テスト環境は node なので window/document/localStorage を手で用意する。
// matchMedia は「変化リスナーの張り直し/解除」を検証するためにスパイ可能なモックにする。

let mediaMatches = false; // (prefers-color-scheme: dark) の現在値
const addSpy = vi.fn();
const removeSpy = vi.fn();

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
  const attrs = new Map<string, string>();
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: {
      setAttribute: (k: string, v: string) => { attrs.set(k, v); },
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: (q: string) => ({
      matches: q.includes('dark') ? mediaMatches : false,
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    }),
  };
  // theme.ts は window/document を直接参照するのでグローバルにも生やす
  (globalThis as unknown as { matchMedia: unknown }).matchMedia =
    (globalThis as unknown as { window: { matchMedia: unknown } }).window.matchMedia;
});

beforeEach(() => {
  localStorage.clear();
  mediaMatches = false;
  addSpy.mockClear();
  removeSpy.mockClear();
  vi.resetModules(); // theme.ts のモジュールレベル mql 状態を毎回リセット
});

function currentDataTheme(): string | null {
  return (globalThis as unknown as { document: { documentElement: { getAttribute(k: string): string | null } } })
    .document.documentElement.getAttribute('data-theme');
}

describe('resolveTheme', () => {
  it('light/dark はそのまま返す', async () => {
    const m = await import('./theme');
    expect(m.resolveTheme('light')).toBe('light');
    expect(m.resolveTheme('dark')).toBe('dark');
  });

  it('system は OS の prefers-color-scheme に従う', async () => {
    const m = await import('./theme');
    mediaMatches = false;
    expect(m.resolveTheme('system')).toBe('light');
    mediaMatches = true;
    expect(m.resolveTheme('system')).toBe('dark');
  });
});

describe('getTheme フォールバック', () => {
  it('未設定なら system', async () => {
    const { getTheme } = await import('./prefs');
    expect(getTheme()).toBe('system');
  });

  it('不正値なら system に倒す', async () => {
    localStorage.setItem('aozoraquest:theme', 'wat');
    const { getTheme } = await import('./prefs');
    expect(getTheme()).toBe('system');
  });

  it('保存済みの light/dark/system は round-trip する', async () => {
    const { getTheme, setTheme } = await import('./prefs');
    setTheme('light');
    expect(getTheme()).toBe('light');
    setTheme('dark');
    expect(getTheme()).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('html[data-theme] に解決後の値を入れる', async () => {
    const m = await import('./theme');
    m.applyTheme('light');
    expect(currentDataTheme()).toBe('light');
    m.applyTheme('dark');
    expect(currentDataTheme()).toBe('dark');
    mediaMatches = true;
    m.applyTheme('system');
    expect(currentDataTheme()).toBe('dark');
  });

  it("system 選択時だけ matchMedia リスナーを張り、light/dark では張らない", async () => {
    const m = await import('./theme');
    m.applyTheme('system');
    expect(addSpy).toHaveBeenCalledTimes(1);
    // light に切り替えると system 監視は解除される
    m.applyTheme('light');
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it('system を連打してもリスナーは二重登録されない (毎回 remove→add)', async () => {
    const m = await import('./theme');
    m.applyTheme('system');
    m.applyTheme('system');
    m.applyTheme('system');
    // 2 回目以降は古いリスナーを remove してから add するので add=回数, remove=回数-1
    expect(addSpy).toHaveBeenCalledTimes(3);
    expect(removeSpy).toHaveBeenCalledTimes(2);
  });
});
