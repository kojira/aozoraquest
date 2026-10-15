import { beforeEach, describe, expect, test, vi } from 'vitest';
import { craftItem, sellMaterials, CraftLogError } from './crafting';
import { clearCraftLogQueue, enqueueCraftLog, flushCraftLogs, pendingCraftLogs } from './craft-log-queue';

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
/** getRecord は既定で「無い」を返す (= 書けていない)。既に在る状況だけ差し替える。 */
const agentWith = (createRecord: ReturnType<typeof vi.fn>, getRecord?: ReturnType<typeof vi.fn>): never =>
  ({
    assertDid: DID,
    com: {
      atproto: {
        repo: { createRecord, getRecord: getRecord ?? vi.fn(async () => { throw new Error('Could not locate record'); }) },
      },
    },
  } as never);

/** 同 rkey の createRecord で PDS が実際に返す文言 (atproto の mst.ts)。
 *  "already exists" ではないので、文言 grep では重複を検出できない。 */
const DUPLICATE = 'There is already a value at key: app.aozoraquest.craft/s-1';

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

  test('既に書けていたら成功として扱う (応答だけ落ちた再送で永久に詰まらせない)', async () => {
    // PDS の文言に依存せず、同 rkey の record が実在するかで判定する
    const createRecord = vi.fn(async () => { throw new Error(DUPLICATE); });
    const getRecord = vi.fn(async () => ({ data: { uri: 'at://x', cid: 'c', value: {} } }));
    await expect(
      sellMaterials(agentWith(createRecord, getRecord), { materialId: 'slime-drop', materialCount: 30 }, 's-1'),
    ).resolves.toBeTruthy();
    expect(getRecord).toHaveBeenCalledTimes(1);
  });

  test('書けていなければ CraftLogError (取りにいけない時も保留に残す)', async () => {
    const createRecord = vi.fn(async () => { throw new Error('offline'); });
    const getRecord = vi.fn(async () => { throw new Error('offline'); });
    await expect(
      sellMaterials(agentWith(createRecord, getRecord), { materialId: 'slime-drop', materialCount: 30 }, 's-2'),
    ).rejects.toBeInstanceOf(CraftLogError);
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

describe('取りこぼさない / 詰まらない', () => {
  test('再送の往復中に積まれた保留を消さない', async () => {
    enqueueCraftLog(DID, new CraftLogError('c-old', { itemId: 'a' }, new Error('x')), 'now');
    // 1 件目を送っている最中に、店で作った記帳が落ちて積まれる状況を再現する
    const createRecord = vi.fn(async () => {
      enqueueCraftLog(DID, new CraftLogError('c-new', { itemId: 'b' }, new Error('x')), 'now');
      return { data: { uri: 'at://x', cid: 'c' } };
    });
    expect(await flushCraftLogs(agentWith(createRecord), DID)).toBe(1);
    expect(pendingCraftLogs(DID).map((e) => e.rkey)).toEqual(['c-new']);
  });

  test('何度送っても通らない 1 件は上限で捨て、後続が書けるようになる', async () => {
    enqueueCraftLog(DID, new CraftLogError('c-poison', { itemId: 'bad' }, new Error('x')), 'now');
    enqueueCraftLog(DID, new CraftLogError('c-ok', { itemId: 'good' }, new Error('x')), 'now');
    const createRecord = vi.fn(async (a: unknown) => {
      if ((a as { rkey: string }).rkey === 'c-poison') throw new Error('InvalidRequest');
      return { data: { uri: 'at://x', cid: 'c' } };
    });
    const agent = agentWith(createRecord);
    // 4 回は先頭で止まったまま (試行回数を数えている)
    for (let i = 0; i < 4; i += 1) expect(await flushCraftLogs(agent, DID)).toBe(0);
    expect(pendingCraftLogs(DID).map((e) => e.rkey)).toEqual(['c-poison', 'c-ok']);
    // 5 回目で諦めて捨て、後続が書ける
    expect(await flushCraftLogs(agent, DID)).toBe(0);
    expect(pendingCraftLogs(DID).map((e) => e.rkey)).toEqual(['c-ok']);
    expect(await flushCraftLogs(agent, DID)).toBe(1);
    expect(pendingCraftLogs(DID)).toHaveLength(0);
  });

  test('積み直しても試行回数は 0 に戻らない', () => {
    const e = new CraftLogError('c-1', { itemId: 'a' }, new Error('x'));
    enqueueCraftLog(DID, e, 'now');
    localStorage.setItem(`aq.craftlog.pending.${DID}`, JSON.stringify([{ rkey: 'c-1', record: { itemId: 'a' }, queuedAt: 'now', attempts: 3 }]));
    enqueueCraftLog(DID, e, 'later');
    expect(pendingCraftLogs(DID)[0]!.attempts).toBe(3);
  });

  test('ワールドリセットで保留を捨てる (消した記録が書き戻らない)', () => {
    enqueueCraftLog(DID, new CraftLogError('c-1', { itemId: 'a' }, new Error('x')), 'now');
    clearCraftLogQueue(DID);
    expect(pendingCraftLogs(DID)).toHaveLength(0);
  });
});
