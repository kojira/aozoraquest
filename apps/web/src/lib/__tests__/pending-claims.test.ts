import { describe, it, expect, beforeEach } from 'vitest';

// node 環境なので localStorage を用意する (この module は localStorage だけに依存する)。
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
} as Storage;
import { rememberPendingClaim, forgetPendingClaim, pendingClaims, flushPendingClaims, clearPendingClaims, claimPostXp } from '../pending-claims';

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

  it('申告が落ちたら保留に残り、次の申告機会で出し直され、成功で保留から消える (#548)', async () => {
    const sent: string[] = [];
    let online = false;
    const send = async (c: { postUri: string; archetype: string }) => {
      sent.push(c.postUri);
      if (!online) throw new Error('edge down');
      return { granted: 10, jobXp: 10, duplicate: false, power: 1, streakDays: 1 };
    };
    // 1 回目: edge が落ちている → null を返して (投稿処理は続く) 保留に残る
    const r1 = await claimPostXp(send, { postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior' });
    expect(r1).toBeNull();
    expect(pendingClaims().map((c) => c.postUri)).toEqual(['at://me/app.bsky.feed.post/a']);
    // 2 回目 (次の投稿): 復旧している → 先に a を出し直し、b も申告し、保留は空になる
    online = true;
    sent.length = 0;
    const r2 = await claimPostXp(send, { postUri: 'at://me/app.bsky.feed.post/b', archetype: 'warrior' });
    expect(r2?.granted).toBe(10);
    expect(sent).toEqual(['at://me/app.bsky.feed.post/a', 'at://me/app.bsky.feed.post/b']);
    expect(pendingClaims()).toHaveLength(0);
  });

  it('出し直しが失敗しても今回の申告は試み、落ちたら両方を保留に残す', async () => {
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() });
    const r = await claimPostXp(async () => { throw new Error('edge down'); }, { postUri: 'at://me/app.bsky.feed.post/b', archetype: 'warrior' });
    expect(r).toBeNull();
    expect(pendingClaims().map((c) => c.postUri).sort()).toEqual(['at://me/app.bsky.feed.post/a', 'at://me/app.bsky.feed.post/b']);
  });

  it('投稿 URI が無くても溜まっている申告は出し直す', async () => {
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() });
    const sent: string[] = [];
    const r = await claimPostXp(async (c) => { sent.push(c.postUri); return 1; }, null);
    expect(r).toBeNull();
    expect(sent).toEqual(['at://me/app.bsky.feed.post/a']);
    expect(pendingClaims()).toHaveLength(0);
  });

  it('成功した投稿は忘れる', () => {
    rememberPendingClaim({ postUri: 'at://me/app.bsky.feed.post/a', archetype: 'warrior', at: Date.now() });
    forgetPendingClaim('at://me/app.bsky.feed.post/a');
    expect(pendingClaims()).toHaveLength(0);
  });
});
