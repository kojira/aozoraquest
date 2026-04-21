import type { Agent } from '@atproto/api';
import { DIAGNOSIS_MIN_POST_COUNT, DIAGNOSIS_POST_LIMIT, diagnose, type DiagnosisResult } from '@aozoraquest/core';
import { fetchMyPosts, fetchUserPostsForDiagnosis, getRecord, putRecord } from './atproto';
import { getEmbedder } from './embedder';
import { loadPrototypeEmbeddings } from './prototype-loader';

type ProgressCallback = (phase: string, done?: number, total?: number) => void;

/**
 * 全体の診断パイプライン:
 *   1. 投稿 DIAGNOSIS_POST_LIMIT 件取得 (tuning.ts)
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
  const posts = await fetchMyPosts(agent, DIAGNOSIS_POST_LIMIT);

  if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
    return { insufficient: true, postCount: posts.length };
  }

  onProgress('loading-prototypes');
  const embedder = getEmbedder();
  const protos = await loadPrototypeEmbeddings(embedder);

  onProgress('embedding-posts', 0, posts.length);
  const texts = posts.map((p) => p.text);
  const timestamps = posts.map((p) => p.at);
  const postVecs = await embedder.embedBatch(texts, (done, total) =>
    onProgress('embedding-posts', done, total),
  );

  onProgress('analyzing');
  const result = diagnose(postVecs, protos, posts.length, new Date(), { timestamps });

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

/**
 * 他ユーザーの気質を推し量る。PDS には一切書き込まず、戻り値のみ。
 * 相手の公開投稿から DIAGNOSIS_POST_LIMIT 件取得し、ブラウザ内で diagnose() を走らせる。
 */
export async function runDiagnosisForOther(
  agent: Agent,
  actor: string,
  onProgress: ProgressCallback = () => {},
): Promise<DiagnosisResult | { insufficient: true; postCount: number }> {
  onProgress('fetching-posts');
  const posts = await fetchUserPostsForDiagnosis(agent, actor, DIAGNOSIS_POST_LIMIT);
  if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
    return { insufficient: true, postCount: posts.length };
  }

  onProgress('loading-prototypes');
  const embedder = getEmbedder();
  const protos = await loadPrototypeEmbeddings(embedder);

  onProgress('embedding-posts', 0, posts.length);
  const texts = posts.map((p) => p.text);
  const timestamps = posts.map((p) => p.at);
  const postVecs = await embedder.embedBatch(texts, (done, total) =>
    onProgress('embedding-posts', done, total),
  );

  onProgress('analyzing');
  const result = diagnose(postVecs, protos, posts.length, new Date(), { timestamps });
  if ('insufficient' in result) return result;

  onProgress('done');
  return result; // PDS には書かない (閲覧側のローカル表示専用)
}
