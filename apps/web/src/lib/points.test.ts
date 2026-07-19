import { describe, expect, test, vi } from 'vitest';
import { SUMMON_THRESHOLD, loadPointsState } from './points';

function makeAgent(scenario: {
  posts: Array<{ via?: string }>;
  spiritChat: Array<{ role: string }>;
}): any {
  const listRecords = vi.fn(async ({ collection, cursor }: { collection: string; cursor?: string }) => {
    if (collection === 'app.bsky.feed.post') {
      // 1 ページ目のみ返す (MVP では上限 500 件想定なので 1 ページで網羅)
      if (cursor) return { data: { records: [] } };
      return {
        data: {
          records: scenario.posts.map((p, i) => ({
            uri: `at://did:test/app.bsky.feed.post/${i}`,
            cid: `cid${i}`,
            value: p,
          })),
        },
      };
    }
    if (collection === 'app.aozoraquest.spiritChat') {
      if (cursor) return { data: { records: [] } };
      return {
        data: {
          records: scenario.spiritChat.map((m, i) => ({
            uri: `at://did:test/app.aozoraquest.spiritChat/${i}`,
            cid: `cid${i}`,
            value: m,
          })),
        },
      };
    }
    return { data: { records: [] } };
  });
  return { com: { atproto: { repo: { listRecords } } } };
}

describe('craftPowerSpent (制作の消費パワー)', () => {
  test('残高から累積額が引かれる', async () => {
    const { loadPointsState } = await import('./points');
    const agent = {
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: {
          viaPosts: 100, userMessages: 5, cardDraws: 3, battles: 2, craftPowerSpent: 44,
          summoned: true, updatedAt: 'x',
        } } }),
      } } },
    } as any;
    const p = await loadPointsState(agent, 'did:test');
    expect(p.craftPowerSpent).toBe(44);
    expect(p.balance).toBe(100 - 5 - 3 - 2 - 44);
  });
});

describe('salePowerEarned (ひきとりの獲得パワー)', () => {
  test('残高に加算される', async () => {
    const { loadPointsState } = await import('./points');
    const agent = {
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: {
          viaPosts: 20, userMessages: 2, cardDraws: 1, battles: 4, craftPowerSpent: 8, salePowerEarned: 3,
          summoned: true, updatedAt: 'x',
        } } }),
      } } },
    } as any;
    const p = await loadPointsState(agent, 'did:test');
    expect(p.salePowerEarned).toBe(3);
    expect(p.balance).toBe(20 - 2 - 1 - 4 - 8 + 3);
  });

  test('searchPowerSpent (しらべる消費) が balance から引かれる', async () => {
    const agent = {
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: {
          viaPosts: 30, userMessages: 0, cardDraws: 0, battles: 0, craftPowerSpent: 0,
          salePowerEarned: 0, searchPowerSpent: 5, summoned: true, updatedAt: 'x',
        } } }),
      } } },
    } as any;
    const p = await loadPointsState(agent, 'did:test');
    expect(p.searchPowerSpent).toBe(5);
    expect(p.balance).toBe(25); // 30 - 5
  });

  test('旧レコード (searchPowerSpent 欠落) は 0 扱い', async () => {
    const agent = {
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: {
          viaPosts: 10, userMessages: 0, cardDraws: 0, summoned: true, updatedAt: 'x',
        } } }),
      } } },
    } as any;
    const p = await loadPointsState(agent, 'did:test');
    expect(p.searchPowerSpent).toBe(0);
    expect(p.balance).toBe(10);
  });
});

describe('loadPointsState', () => {
  test('空状態: 全部 0、summoned=false', async () => {
    const agent = makeAgent({ posts: [], spiritChat: [] });
    const p = await loadPointsState(agent, 'did:test');
    expect(p).toEqual({
      viaPosts: 0,
      userMessages: 0,
      cardDraws: 0,
      battles: 0,
      craftPowerSpent: 0,
      salePowerEarned: 0,
      searchPowerSpent: 0,
      summoned: false,
      balance: 0,
      toSummon: SUMMON_THRESHOLD,
    });
  });

  test('battle レコードは 1 件 1 パワー消費として balance から引かれる', async () => {
    const agent = makeAgent({
      posts: Array(10).fill({ via: 'AozoraQuest' }),
      spiritChat: [],
    });
    // battle collection にレコード 4 件 (勝敗は消費量に関係しない)
    const orig = agent.com.atproto.repo.listRecords;
    agent.com.atproto.repo.listRecords = vi.fn(async (args: { collection: string; cursor?: string }) => {
      if (args.collection.endsWith('.battle')) {
        if (args.cursor) return { data: { records: [] } };
        return {
          data: {
            records: Array.from({ length: 4 }, (_, i) => ({
              uri: `at://did:test/battle/${i}`,
              cid: `c${i}`,
              value: { outcome: i % 2 ? 'win' : 'lose' },
            })),
          },
        };
      }
      return orig(args);
    });
    const p = await loadPointsState(agent, 'did:test');
    expect(p.battles).toBe(4);
    expect(p.balance).toBe(10 - 4);
  });

  test('via 投稿 3 件 + チャットなし → toSummon 7', async () => {
    const agent = makeAgent({
      posts: [{ via: 'AozoraQuest' }, { via: 'AozoraQuest' }, { via: 'AozoraQuest' }],
      spiritChat: [],
    });
    const p = await loadPointsState(agent, 'did:test');
    expect(p.viaPosts).toBe(3);
    expect(p.toSummon).toBe(SUMMON_THRESHOLD - 3);
    expect(p.summoned).toBe(false);
  });

  test('他クライアントの投稿は数えない', async () => {
    const agent = makeAgent({
      posts: [{ via: 'AozoraQuest' }, { via: 'TOKIMEKI' }, {}, { via: 'AozoraQuest' }],
      spiritChat: [],
    });
    const p = await loadPointsState(agent, 'did:test');
    expect(p.viaPosts).toBe(2);
  });

  test('召喚済み: spirit レコード 1 件以上で summoned=true', async () => {
    const agent = makeAgent({
      posts: Array(12).fill({ via: 'AozoraQuest' }),
      spiritChat: [{ role: 'spirit' }, { role: 'user' }, { role: 'spirit' }],
    });
    const p = await loadPointsState(agent, 'did:test');
    expect(p.summoned).toBe(true);
    expect(p.userMessages).toBe(1);
    expect(p.balance).toBe(12 - 1);
    expect(p.toSummon).toBe(0);
  });

  test('balance は負にならない (過剰メッセージは 0 止め)', async () => {
    const agent = makeAgent({
      posts: [{ via: 'AozoraQuest' }],
      spiritChat: [{ role: 'user' }, { role: 'user' }, { role: 'spirit' }],
    });
    const p = await loadPointsState(agent, 'did:test');
    expect(p.balance).toBe(0);
  });
});

describe('resetWorldPower (オンボードリセット)', () => {
  test('world 消費/獲得を 0 にし、投稿由来 + summoned を保持、歓迎ボーナスを絶対値で載せる', async () => {
    const { resetWorldPower } = await import('./points');
    let written: any = null;
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: {
          viaPosts: 100, userMessages: 5, cardDraws: 3, battles: 7, craftPowerSpent: 40, salePowerEarned: 12, searchPowerSpent: 6,
          summoned: true, updatedAt: 'x',
        } } }),
        putRecord: vi.fn(async (args: any) => { written = args.record; return { data: {} }; }),
      } } },
    } as any;
    await resetWorldPower(agent, 'did:test', 20);
    // 投稿由来 (viaPosts/userMessages/cardDraws) と summoned は保持
    expect(written).toMatchObject({ viaPosts: 100, userMessages: 5, cardDraws: 3, summoned: true });
    // world 由来の消費/獲得は全部 0、歓迎ボーナスだけ salePowerEarned に (絶対値)
    expect(written.battles).toBe(0);
    expect(written.craftPowerSpent).toBe(0);
    expect(written.searchPowerSpent).toBe(0);
    expect(written.salePowerEarned).toBe(20);
  });

  test('冪等: 書き込み後の record を読んで再実行しても +20 が二重にならない', async () => {
    const { resetWorldPower } = await import('./points');
    let written: any = { viaPosts: 100, userMessages: 5, cardDraws: 3, battles: 0, craftPowerSpent: 0, salePowerEarned: 20, searchPowerSpent: 0, summoned: true, updatedAt: 'x' };
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: {
        getRecord: async () => ({ data: { value: written } }),
        putRecord: vi.fn(async (args: any) => { written = { ...args.record, updatedAt: 'y' }; return { data: {} }; }),
      } } },
    } as any;
    await resetWorldPower(agent, 'did:test', 20);
    expect(written.salePowerEarned).toBe(20); // += でなく絶対値なので二重加算しない
  });
});
