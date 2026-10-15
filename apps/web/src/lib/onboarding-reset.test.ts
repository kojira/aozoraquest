import { afterEach, describe, expect, test, vi } from 'vitest';
import { armOnboardingReplay, deleteAllRecords, ONBOARDING_DONE_KEY, WELCOME_BLESSING_PENDING_KEY } from './onboarding-reset';

/** Map ベースの最小 Storage モック (node 環境には localStorage/sessionStorage が無い)。 */
function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: vi.fn((k: string, v: string) => { m.set(k, v); }),
    removeItem: vi.fn((k: string) => { m.delete(k); }),
    _map: m,
  };
}

/** listRecords が total 件 (100 件/ページ) 返すモック agent。deleteRecord を記録。 */
function makeAgent(total: number) {
  const deleteRecord = vi.fn(async (_args: { repo: string; collection: string; rkey: string }) => ({ data: {} }));
  const listRecords = vi.fn(async ({ cursor }: { cursor?: string }) => {
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 100, total);
    const records = Array.from({ length: end - start }, (_, i) => ({ uri: `at://did:test/col/rk${start + i}` }));
    return { data: { records, ...(end < total ? { cursor: String(end) } : {}) } };
  });
  return { agent: { com: { atproto: { repo: { listRecords, deleteRecord } } } } as any, deleteRecord, listRecords };
}

describe('deleteAllRecords (並列バッチ削除)', () => {
  test('全レコードを deleteRecord で消す (ページングして 250 件すべて)', async () => {
    const { agent, deleteRecord, listRecords } = makeAgent(250);
    await deleteAllRecords(agent, 'did:test', 'app.aozoraquest.craft');
    // 250 件すべて削除 (逐次でなく並列バッチだが、呼び出し回数は 1 件 1 回)
    expect(deleteRecord).toHaveBeenCalledTimes(250);
    const rkeys = deleteRecord.mock.calls.map((c) => (c[0] as { rkey: string }).rkey).sort();
    expect(rkeys).toContain('rk0');
    expect(rkeys).toContain('rk249');
    expect(new Set(rkeys).size).toBe(250); // 重複なし
    // listRecords は 3 ページ (100+100+50) 舐める
    expect(listRecords).toHaveBeenCalledTimes(3);
  });

  test('個々の deleteRecord 失敗は握りつぶして続行 (存在しない rkey 等)', async () => {
    const { agent, deleteRecord } = makeAgent(30);
    deleteRecord.mockImplementation(async () => { throw new Error('RecordNotFound'); });
    await expect(deleteAllRecords(agent, 'did:test', 'x')).resolves.toBeUndefined();
    expect(deleteRecord).toHaveBeenCalledTimes(30); // 失敗しても全件試す
  });

  test('0 件なら deleteRecord を呼ばない / 未作成 (listRecords throw) は無害', async () => {
    const { agent, deleteRecord } = makeAgent(0);
    await deleteAllRecords(agent, 'did:test', 'x');
    expect(deleteRecord).not.toHaveBeenCalled();

    const throwing = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('nope'); }), deleteRecord: vi.fn() } } } } as any;
    await expect(deleteAllRecords(throwing, 'did:test', 'x')).resolves.toBeUndefined();
    expect(throwing.com.atproto.repo.deleteRecord).not.toHaveBeenCalled();
  });
});

describe('armOnboardingReplay (オンボード再生の準備)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('onboarding-done を消し、祝福マークを 1 にする', () => {
    const local = mockStorage();
    const session = mockStorage();
    local._map.set(ONBOARDING_DONE_KEY, '1'); // 既に見終えた状態から
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', session);

    armOnboardingReplay();

    expect(local.removeItem).toHaveBeenCalledWith(ONBOARDING_DONE_KEY); // イントロを再表示
    expect(local._map.has(ONBOARDING_DONE_KEY)).toBe(false);
    expect(session.setItem).toHaveBeenCalledWith(WELCOME_BLESSING_PENDING_KEY, '1'); // 祝福演出のマーク
    expect(session._map.get(WELCOME_BLESSING_PENDING_KEY)).toBe('1');
  });

  test('storage が throw しても例外を投げない (private mode 等)', () => {
    vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('denied'); } });
    vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('denied'); } });
    expect(() => armOnboardingReplay()).not.toThrow();
  });
});
