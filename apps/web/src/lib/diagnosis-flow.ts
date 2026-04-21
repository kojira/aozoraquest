import type { Agent } from '@atproto/api';
import { diagnose, type DiagnosisResult } from '@aozoraquest/core';
import { fetchMyPosts, putRecord } from './atproto';
import { getEmbedder } from './embedder';
import { loadPrototypeEmbeddings } from './prototype-loader';

type ProgressCallback = (phase: string, done?: number, total?: number) => void;

/**
 * 全体の診断パイプライン:
 *   1. 投稿 150 件取得
 *   2. プロトタイプ埋め込みをロード (初回はランタイム計算、キャッシュしたい)
 *   3. 各投稿を埋め込み
 *   4. core.diagnose() で RPG 合成
 *   5. PDS の app.aozoraquest.analysis/self に保存
 */
export async function runDiagnosis(
  agent: Agent,
  onProgress: ProgressCallback = () => {},
): Promise<DiagnosisResult | { insufficient: true; postCount: number }> {
  onProgress('fetching-posts');
  const posts = await fetchMyPosts(agent, 150);

  if (posts.length < 50) {
    return { insufficient: true, postCount: posts.length };
  }

  onProgress('loading-prototypes');
  const embedder = getEmbedder();
  const protos = await loadPrototypeEmbeddings(embedder);

  onProgress('embedding-posts', 0, posts.length);
  const postVecs = await embedder.embedBatch(posts, (done, total) =>
    onProgress('embedding-posts', done, total),
  );

  onProgress('analyzing');
  const result = diagnose(postVecs, protos, posts.length);

  if ('insufficient' in result) return result;

  onProgress('saving');
  await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
    archetype: result.archetype,
    rpgStats: result.rpgStats,
    cognitiveScores: result.cognitiveScores,
    confidence: result.confidence,
    analyzedPostCount: result.analyzedPostCount,
    analyzedAt: result.analyzedAt,
    public: false,
  });

  onProgress('done');
  return result;
}
