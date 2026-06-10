import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getPostQuestNotifications (dev/prod gate)', () => {
  it('dev 環境 (VITE_NSID_ENV=dev) では default false', async () => {
    vi.stubEnv('VITE_NSID_ENV', 'dev');
    const m = await import('./prefs');
    expect(m.getPostQuestNotifications()).toBe(false);
    expect(m.getPostQuestNotificationsDefault()).toBe(false);
  });

  it('production (VITE_NSID_ENV 未設定) では default true', async () => {
    vi.stubEnv('VITE_NSID_ENV', '');
    const m = await import('./prefs');
    expect(m.getPostQuestNotifications()).toBe(true);
    expect(m.getPostQuestNotificationsDefault()).toBe(true);
  });

  it('localStorage に "true" があれば dev でも投稿する', async () => {
    vi.stubEnv('VITE_NSID_ENV', 'dev');
    localStorage.setItem('aozoraquest:postQuestNotifications', 'true');
    const m = await import('./prefs');
    expect(m.getPostQuestNotifications()).toBe(true);
    // default だけは env のままなので OFF を返す
    expect(m.getPostQuestNotificationsDefault()).toBe(false);
  });

  it('localStorage に "false" があれば production でも投稿しない', async () => {
    vi.stubEnv('VITE_NSID_ENV', '');
    localStorage.setItem('aozoraquest:postQuestNotifications', 'false');
    const m = await import('./prefs');
    expect(m.getPostQuestNotifications()).toBe(false);
  });
});

describe('setPostQuestNotifications', () => {
  it('明示 ON → localStorage に "true"', async () => {
    vi.stubEnv('VITE_NSID_ENV', 'dev');
    const m = await import('./prefs');
    m.setPostQuestNotifications(true);
    expect(localStorage.getItem('aozoraquest:postQuestNotifications')).toBe('true');
    expect(m.getPostQuestNotifications()).toBe(true);
  });

  it('明示 OFF → localStorage に "false"', async () => {
    vi.stubEnv('VITE_NSID_ENV', '');
    const m = await import('./prefs');
    m.setPostQuestNotifications(false);
    expect(localStorage.getItem('aozoraquest:postQuestNotifications')).toBe('false');
    expect(m.getPostQuestNotifications()).toBe(false);
  });
});

describe('clampFontScale', () => {
  it('範囲内はそのまま (整数化)', async () => {
    const m = await import('./prefs');
    expect(m.clampFontScale(80)).toBe(80);
    expect(m.clampFontScale(100)).toBe(100);
    expect(m.clampFontScale(150)).toBe(150);
  });

  it('下限を割ったら下限', async () => {
    const m = await import('./prefs');
    expect(m.clampFontScale(10)).toBe(50);
  });

  it('上限を超えたら上限', async () => {
    const m = await import('./prefs');
    expect(m.clampFontScale(200)).toBe(150);
  });
});
