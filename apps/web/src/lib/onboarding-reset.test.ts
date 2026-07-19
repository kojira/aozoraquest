import { describe, expect, test, vi } from 'vitest';
import { deleteAllRecords } from './onboarding-reset';

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
