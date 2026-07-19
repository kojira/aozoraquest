import { describe, expect, test, vi } from 'vitest';
import { deleteAllRecords } from './onboarding-reset';

/** listRecords が n 件 (100 件/ページ) 返すモック agent。applyWrites/deleteRecord を記録。 */
function makeAgent(total: number) {
  const applyWrites = vi.fn(async (_args: { repo: string; writes: unknown[] }) => ({ data: {} }));
  const deleteRecord = vi.fn(async (_args: unknown) => ({ data: {} }));
  const listRecords = vi.fn(async ({ cursor }: { cursor?: string }) => {
    const start = cursor ? Number(cursor) : 0;
    const end = Math.min(start + 100, total);
    const records = Array.from({ length: end - start }, (_, i) => ({ uri: `at://did:test/col/rk${start + i}` }));
    return { data: { records, ...(end < total ? { cursor: String(end) } : {}) } };
  });
  return { agent: { com: { atproto: { repo: { listRecords, applyWrites, deleteRecord } } } } as any, applyWrites, deleteRecord, listRecords };
}

describe('deleteAllRecords (バッチ削除)', () => {
  test('250 件を 200 件/リクエストの applyWrites で一括削除 (逐次 deleteRecord を使わない)', async () => {
    const { agent, applyWrites, deleteRecord } = makeAgent(250);
    await deleteAllRecords(agent, 'did:test', 'app.aozoraquest.craft');
    // 逐次 deleteRecord は使わない (これが実機ハングの原因だった)
    expect(deleteRecord).not.toHaveBeenCalled();
    // 250 件 → ceil(250/200) = 2 リクエスト
    expect(applyWrites).toHaveBeenCalledTimes(2);
    const first = applyWrites.mock.calls[0]![0] as any;
    expect(first.writes).toHaveLength(200);
    expect(first.writes[0]).toMatchObject({ $type: 'com.atproto.repo.applyWrites#delete', collection: 'app.aozoraquest.craft', rkey: 'rk0' });
    const second = applyWrites.mock.calls[1]![0] as any;
    expect(second.writes).toHaveLength(50);
  });

  test('0 件なら applyWrites を呼ばない / 未作成 (listRecords throw) は無害', async () => {
    const { agent, applyWrites } = makeAgent(0);
    await deleteAllRecords(agent, 'did:test', 'app.aozoraquest.craft');
    expect(applyWrites).not.toHaveBeenCalled();

    const throwing = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('nope'); }), applyWrites: vi.fn() } } } } as any;
    await expect(deleteAllRecords(throwing, 'did:test', 'x')).resolves.toBeUndefined();
    expect(throwing.com.atproto.repo.applyWrites).not.toHaveBeenCalled();
  });
});
