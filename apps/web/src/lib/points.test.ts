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

describe('loadPointsState', () => {
  test('空状態: 全部 0、summoned=false', async () => {
    const agent = makeAgent({ posts: [], spiritChat: [] });
    const p = await loadPointsState(agent, 'did:test');
    expect(p).toEqual({
      viaPosts: 0,
      userMessages: 0,
      summoned: false,
      balance: 0,
      toSummon: SUMMON_THRESHOLD,
    });
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
