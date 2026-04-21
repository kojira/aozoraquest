import type { Agent } from '@atproto/api';
import { diagnose, type DiagnosisResult } from '@aozoraquest/core';
import { fetchMyPosts, getRecord, putRecord } from './atproto';
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

  // 既存レコード (あれば) を読み込んで playerLevel / jobLevel を引き継ぐ。
  // - playerLevel: 常に保持。archetype が変わっても個人の累積は途切れない。
  // - jobLevel: 同じ archetype なら XP 継続、違えば新 archetype で xp=0 再スタート。
  const existing = await getRecord<DiagnosisResult>(agent, agent.assertDid ?? '', 'app.aozoraquest.analysis', 'self')
    .catch(() => null);
  const playerLevel = existing?.playerLevel ?? { xp: 0, streakDays: 0 };
  const jobLevel =
    existing?.jobLevel && existing.jobLevel.archetype === result.archetype
      ? existing.jobLevel
      : { archetype: result.archetype, xp: 0, joinedAt: result.analyzedAt };

  await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
    archetype: result.archetype,
    rpgStats: result.rpgStats,
    cognitiveScores: result.cognitiveScores,
    confidence: result.confidence,
    analyzedPostCount: result.analyzedPostCount,
    analyzedAt: result.analyzedAt,
    public: false,
    jobLevel,
    playerLevel,
  });

  onProgress('done');
  return { ...result, jobLevel, playerLevel };
}
