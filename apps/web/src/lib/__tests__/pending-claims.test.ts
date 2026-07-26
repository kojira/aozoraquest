import { describe, it, expect, beforeEach } from 'vitest';

// node 環境なので localStorage を用意する (この module は localStorage だけに依存する)。
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
} as Storage;
import { rememberPendingClaim, forgetPendingClaim, pendingClaims, flushPendingClaims, clearPendingClaims } from '../pending-claims';

describe('申告できなかった投稿の出し直し (#551)', () => {
  beforeEach(() => clearPendingClaims());

  it('落ちた申告を覚えて、次の機会に出し直す', async () => {
    // 申告は投稿時にしか走らないので、覚えておかないと PDS の一時障害だけで
    // その投稿の XP が永久に消える。
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() });
    expect(pendingClaims()).toHaveLength(1);
    const sent: string[] = [];
    const done = await flushPendingClaims(async (c) => { sent.push(c.postUri); });
    expect(done).toBe(1);
    expect(sent).toEqual(['at://me/app.bsky.feed.post/a']);
    expect(pendingClaims()).toHaveLength(0); // 成功したものは忘れる
  });

  it('失敗したらそこで止める (通信が死んでいるなら残りも失敗する)', async () => {
    for (const k of ['a', 'b', 'c']) {
      rememberPendingClaim({ postUri: `at://me/app.bsky.feed.post/${k}`, archetype: 'warrior', at: Date.now() });
    }
    let n = 0;
    const done = await flushPendingClaims(async () => { n++; if (n === 2) throw new Error('offline'); });
    expect(done).toBe(1);
    expect(n).toBe(2); // 3 件目は投げない
    expect(pendingClaims()).toHaveLength(2); // 残りは次回に回す
  });

  it('同じ投稿は 1 件にまとまる', () => {
    const c = { postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() };
    rememberPendingClaim(c);
    rememberPendingClaim(c);
    expect(pendingClaims()).toHaveLength(1);
  });

  it('古すぎるものは捨てる (サーバーの年齢制限に当たるので送っても無駄)', () => {
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/old', archetype: 'warrior', at: Date.now() - 5 * 24 * 3600 * 1000 });
    expect(pendingClaims()).toHaveLength(0);
  });

  it('成功した投稿は忘れる', () => {
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() });
    forgetPendingClaim('at://me/app.bsky.feed.post/a');
    expect(pendingClaims()).toHaveLength(0);
  });
});
