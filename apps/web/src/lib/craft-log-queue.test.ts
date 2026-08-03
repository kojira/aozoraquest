import { beforeEach, describe, expect, test, vi } from 'vitest';
import { craftItem, sellMaterials, CraftLogError } from './crafting';
import { enqueueCraftLog, flushCraftLogs, pendingCraftLogs } from './craft-log-queue';

/**
 * 記帳 (ユーザー PDS の履歴) が書けなかったときの保留と再送 (#642)。
 *
 * 所持の権威はサーバーなので記帳の失敗で品は消えないが、黙って捨てると履歴が永久に欠け、
 * パワー会計 (points.ts は craft コレクションを再スキャンして消費/獲得を出す) もずれる。
 */

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const DID = 'did:test';
const agentWith = (createRecord: ReturnType<typeof vi.fn>): never =>
  ({ assertDid: DID, com: { atproto: { repo: { createRecord } } } } as never);

describe('記帳の失敗を保留する', () => {
  test('craftItem が落ちたら rkey と record を持った CraftLogError になる', async () => {
    const createRecord = vi.fn(async () => { throw new Error('upstream 502'); });
    const err = await craftItem(
      agentWith(createRecord),
      { itemId: 'wp-knife', materialId: 'slime-drop', materialCount: 1, power: 4, luk: 0 },
      'c-fixed',
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CraftLogError);
    const e = err as CraftLogError;
    expect(e.rkey).toBe('c-fixed');
    expect(e.record['itemId']).toBe('wp-knife');
    expect(e.record['power']).toBe(4);
  });

  test('「既にある」は成功として扱う (応答だけ落ちた再送で永久に詰まらせない)', async () => {
    const createRecord = vi.fn(async () => { throw new Error('Record already exists'); });
    await expect(
      sellMaterials(agentWith(createRecord), { materialId: 'slime-drop', materialCount: 30 }, 's-1'),
    ).resolves.toBeTruthy();
  });

  test('保留に積むと DID 単位で残り、同じ rkey は二重に積まれない', () => {
    const e = new CraftLogError('c-1', { itemId: 'wp-knife' }, new Error('x'));
    enqueueCraftLog(DID, e, '2026-08-03T00:00:00.000Z');
    enqueueCraftLog(DID, e, '2026-08-03T00:01:00.000Z');
    expect(pendingCraftLogs(DID)).toHaveLength(1);
    expect(pendingCraftLogs('did:other')).toHaveLength(0);
  });
});

describe('保留した記帳を書き直す', () => {
  test('同じ rkey・同じ内容で書き直し、書けたら保留から消える', async () => {
    enqueueCraftLog(DID, new CraftLogError('c-1', { itemId: 'wp-knife', power: 4 }, new Error('x')), 'now');
    const createRecord = vi.fn(async (_a: unknown) => ({ data: { uri: 'at://x', cid: 'c' } }));
    const done = await flushCraftLogs(agentWith(createRecord), DID);
    expect(done).toBe(1);
    const arg = createRecord.mock.calls[0]![0] as { rkey: string; record: Record<string, unknown> };
    expect(arg.rkey).toBe('c-1');
    expect(arg.record['itemId']).toBe('wp-knife');
    expect(pendingCraftLogs(DID)).toHaveLength(0);
  });

  test('途中で落ちたら書けた分だけ消し、残りは次の機会に持ち越す', async () => {
    enqueueCraftLog(DID, new CraftLogError('c-1', { itemId: 'a' }, new Error('x')), 'now');
    enqueueCraftLog(DID, new CraftLogError('c-2', { itemId: 'b' }, new Error('x')), 'now');
    enqueueCraftLog(DID, new CraftLogError('c-3', { itemId: 'c' }, new Error('x')), 'now');
    let n = 0;
    const createRecord = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error('offline');
      return { data: { uri: 'at://x', cid: 'c' } };
    });
    const done = await flushCraftLogs(agentWith(createRecord), DID);
    expect(done).toBe(1);
    // 落ちた 1 件で打ち切る (落ちている相手に残り全部を投げない)
    expect(createRecord).toHaveBeenCalledTimes(2);
    expect(pendingCraftLogs(DID).map((e) => e.rkey)).toEqual(['c-2', 'c-3']);
  });

  test('保留が無ければ書きにいかない', async () => {
    const createRecord = vi.fn(async () => ({ data: { uri: 'at://x', cid: 'c' } }));
    expect(await flushCraftLogs(agentWith(createRecord), DID)).toBe(0);
    expect(createRecord).not.toHaveBeenCalled();
  });
});
