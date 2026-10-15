// Test entry only: 投稿の解析 / 診断 (c) / TL 気質分析 を本物のモジュールで動かす。PDS は in-memory。
import type { Agent } from '@atproto/api';
import { processSelfPost } from '../../src/lib/post-processor';
import { runDiagnosis } from '../../src/lib/diagnosis-flow';
import { getCognitiveClassifier, disposeCognitiveClassifier } from '../../src/lib/cognitive-wgsl';

const DID = 'did:plc:mlpaths';
const repo = new Map<string, unknown>();
const key = (p: { collection: string; rkey: string }) => `${p.collection}/${p.rkey}`;
// 日本語は 20 件だけ (分類器が採用するのは 50 件未満) → 診断は (c) の prototype 方式へ進む
const feed = Array.from({ length: 60 }, (_, i) => ({
  post: {
    indexedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    record: { text: i < 20 ? `今日は${i}回目の散歩に行って、川沿いの景色をゆっくり眺めてきました。` : `Weekly update number ${i}: shipped a few fixes today.` },
  },
}));
const agent = {
  assertDid: DID,
  getAuthorFeed: async () => ({ data: { feed } }),
  com: { atproto: {
    repo: {
      getRecord: async (p: { collection: string; rkey: string }) => {
        if (!repo.has(key(p))) throw Object.assign(new Error('RecordNotFound'), { name: 'RecordNotFoundError' });
        return { data: { value: repo.get(key(p)) } };
      },
      putRecord: async (p: { collection: string; rkey: string; record: unknown }) => { repo.set(key(p), p.record); return { data: {} }; },
    },
    server: { getServiceAuth: async () => ({ data: { token: 'x.eyJleHAiOjk5OTk5OTk5OTl9.x' } }) },
  } },
} as unknown as Agent;

const w = window as unknown as Record<string, unknown>;
w.mlPaths = {
  async post(text: string) {
    const r = await processSelfPost(agent, DID, text, undefined, 'at://did:plc:mlpaths/app.bsky.feed.post/1');
    return { action: r.action, updatedCognitive: r.updatedCognitive ?? null, keys: [...repo.keys()] };
  },
  async diagnose() {
    try {
      const phases: string[] = [];
      const r = await runDiagnosis(agent, (phase) => phases.push(phase));
      return { ok: true, archetype: 'archetype' in r ? r.archetype : null, phases };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    }
  },
  async timeline(text: string) {
    try {
      return { ok: true, scores: await getCognitiveClassifier().classifyPost(text) };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    } finally {
      disposeCognitiveClassifier();
    }
  },
  seedAnalysis(collection: string, value: unknown) { repo.set(`${collection}/self`, value); },
};
w.mlPathsReady = true;
