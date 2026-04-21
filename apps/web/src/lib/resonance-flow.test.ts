import { describe, expect, test } from 'vitest';
import type { DiagnosisResult } from '@aozoraquest/core';
import { buildResonanceTimeline } from './resonance-flow';

type FeedItem = { post: { uri: string; record: { createdAt: string } } };

/** fetchAuthorFeed / getRecord はエージェント経由なので、
 * 擬似 Agent を渡して差し込み (動的 import は不要、com.atproto.repo.getRecord をモック)。
 */
function makeAgent(scenarios: Record<string, { posts: FeedItem[]; diag?: DiagnosisResult }>): any {
  return {
    getAuthorFeed: async ({ actor, limit }: { actor: string; limit: number }) => ({
      data: { feed: (scenarios[actor]?.posts ?? []).slice(0, limit) },
    }),
    com: {
      atproto: {
        repo: {
          getRecord: async ({ repo, collection }: { repo: string; collection: string }) => {
            if (collection !== 'app.aozoraquest.analysis') throw new Error('unexpected collection');
            const d = scenarios[repo]?.diag;
            if (!d) throw new Error('RecordNotFound');
            return { data: { value: d } };
          },
        },
      },
    },
  };
}

function mkPost(uri: string, createdAt: string): FeedItem {
  return { post: { uri, record: { createdAt } } };
}

function mkDiag(atk: number, def: number, agi: number, int: number, luk: number): DiagnosisResult {
  return {
    archetype: 'mage',
    rpgStats: { atk, def, agi, int, luk },
    cognitiveScores: { Ni: 0, Ne: 0, Si: 0, Se: 0, Ti: 0, Te: 0, Fi: 0, Fe: 0 },
    confidence: 'medium',
    analyzedPostCount: 100,
    analyzedAt: '2026-04-01T00:00:00Z',
  };
}

describe('buildResonanceTimeline', () => {
  test('ディレクトリが空なら空', async () => {
    const agent = makeAgent({});
    const out = await buildResonanceTimeline(agent, { selfDiagnosis: null, directoryDids: [] });
    expect(out).toEqual([]);
  });

  test('自分未診断なら score=null で時系列順', async () => {
    const now = Date.now();
    const agent = makeAgent({
      'did:plc:a': { posts: [mkPost('at://a/1', new Date(now - 3600_000).toISOString())] },
      'did:plc:b': { posts: [mkPost('at://b/1', new Date(now - 60_000).toISOString())] },
    });
    const out = await buildResonanceTimeline(agent, {
      selfDiagnosis: null,
      directoryDids: ['did:plc:a', 'did:plc:b'],
    });
    expect(out.map((e) => e.item.post.uri)).toEqual(['at://b/1', 'at://a/1']);
    expect(out.every((e) => e.score == null)).toBe(true);
  });

  test('両者診断あり → 共鳴度で並ぶ (類似度高い方が前)', async () => {
    const now = Date.now();
    // 分散のあるベクトルを使わないと Pearson が 0 に潰れる
    const me = mkDiag(70, 60, 50, 40, 30);
    const close = mkDiag(72, 62, 48, 38, 30); // パターンほぼ同じ → sim 高
    const far = mkDiag(30, 40, 50, 60, 70);   // パターン反転 → sim 低
    const agent = makeAgent({
      'did:plc:close': { posts: [mkPost('at://close/1', new Date(now - 1000).toISOString())], diag: close },
      'did:plc:far': { posts: [mkPost('at://far/1', new Date(now - 1000).toISOString())], diag: far },
    });
    const out = await buildResonanceTimeline(agent, {
      selfDiagnosis: me,
      directoryDids: ['did:plc:far', 'did:plc:close'],
    });
    expect(out[0]!.did).toBe('did:plc:close');
    expect(out[1]!.did).toBe('did:plc:far');
    expect(out.every((e) => typeof e.score === 'number')).toBe(true);
  });

  test('相手未診断の DID は score=null だが含まれる', async () => {
    const now = Date.now();
    const me = mkDiag(50, 50, 50, 50, 50);
    const agent = makeAgent({
      'did:plc:none': { posts: [mkPost('at://none/1', new Date(now - 1000).toISOString())] },
    });
    const out = await buildResonanceTimeline(agent, {
      selfDiagnosis: me,
      directoryDids: ['did:plc:none'],
    });
    expect(out.length).toBe(1);
    expect(out[0]!.score).toBeNull();
  });

  test('fetch 失敗ユーザーは単にスキップされる', async () => {
    const agent: any = {
      getAuthorFeed: async ({ actor }: { actor: string }) => {
        if (actor === 'did:plc:bad') throw new Error('upstream');
        return { data: { feed: [mkPost('at://good/1', new Date().toISOString())] } };
      },
      com: { atproto: { repo: { getRecord: async () => { throw new Error('RecordNotFound'); } } } },
    };
    const out = await buildResonanceTimeline(agent, {
      selfDiagnosis: null,
      directoryDids: ['did:plc:bad', 'did:plc:good'],
    });
    expect(out.map((e) => e.did)).toEqual(['did:plc:good']);
  });

  test('同一著者の投稿は新しい方が前 (freshness 減衰)', async () => {
    const now = Date.now();
    // 分散のあるベクトルで sim > 0 を確保、同一なので共鳴スコアは同じ
    const me = mkDiag(70, 60, 50, 40, 30);
    const agent = makeAgent({
      'did:plc:x': {
        posts: [
          mkPost('at://x/old', new Date(now - 72 * 3600_000).toISOString()),
          mkPost('at://x/new', new Date(now - 60_000).toISOString()),
        ],
        diag: me,
      },
    });
    const out = await buildResonanceTimeline(agent, {
      selfDiagnosis: me,
      directoryDids: ['did:plc:x'],
    });
    expect(out[0]!.item.post.uri).toBe('at://x/new');
    expect(out[1]!.item.post.uri).toBe('at://x/old');
  });
});
