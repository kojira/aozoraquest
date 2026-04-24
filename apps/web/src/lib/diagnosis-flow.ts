import type { Agent } from '@atproto/api';
import type { CognitiveScores } from '@aozoraquest/core';
import {
  DIAGNOSIS_MIN_POST_COUNT,
  DIAGNOSIS_POST_LIMIT,
  diagnose,
  diagnoseFromPerPostScores,
  type DiagnosisResult,
} from '@aozoraquest/core';
import { fetchMyPosts, fetchUserPostsForDiagnosis, getRecord, putRecord } from './atproto';
import { getEmbedder } from './embedder';
import { loadPrototypeEmbeddings } from './prototype-loader';
import { getCognitiveOnnxClassifier } from './cognitive-onnx';
import { isLowEndDevice } from './device';

type ProgressCallback = (phase: string, done?: number, total?: number) => void;

/**
 * 診断の本命パス: fine-tune 済 ONNX 分類器で各投稿を 8 認知機能に直接分類し、
 * 時間軸重み付きで合成する。非日本語 / 短すぎ投稿は null 返しで skip される。
 *
 * ONNX 分類器が利用不能 (webgpu/wasm 両方失敗、モデル配信失敗など) の場合は
 * 旧 prototype embedding 方式に自動フォールバックする。
 */
async function classifyWithOnnx(
  posts: { text: string; at: string }[],
  onProgress: ProgressCallback,
): Promise<{ perPost: CognitiveScores[]; timestamps: string[] } | null> {
  const cog = getCognitiveOnnxClassifier();
  try {
    await cog.init();
  } catch (e) {
    console.warn('[diagnosis] ONNX classifier init failed, falling back to prototype', e);
    return null;
  }
  // 全 post の piece を flatten してバッチ推論する (classifier.classifyPosts の中で
  // chunked sess.run を回す)。単純ループより per-call オーバヘッドが削れて数倍速い。
  onProgress('embedding-posts', 0, posts.length);
  let scoresPerPost: Array<CognitiveScores | null>;
  try {
    scoresPerPost = await cog.classifyPosts(
      posts.map((p) => p.text),
      120,
      (done, total) => {
        // piece 単位の進捗を post 単位に粗く変換して UI へ通知する
        const frac = total > 0 ? done / total : 1;
        onProgress('embedding-posts', Math.min(posts.length, Math.round(frac * posts.length)), posts.length);
      },
    );
  } catch (e) {
    console.warn('[diagnosis] batch classify failed, aborting ONNX path', e);
    return null;
  }
  onProgress('embedding-posts', posts.length, posts.length);

  const perPost: CognitiveScores[] = [];
  const timestamps: string[] = [];
  for (let i = 0; i < posts.length; i++) {
    const s = scoresPerPost[i];
    if (s) {
      perPost.push(s);
      timestamps.push(posts[i]!.at);
    }
  }
  return { perPost, timestamps };
}

/** prototype embedding 方式 (旧): fallback 時のみ使う。 */
async function classifyWithPrototype(
  posts: { text: string; at: string }[],
  onProgress: ProgressCallback,
): Promise<{ postVecs: Float32Array[]; timestamps: string[]; protos: Awaited<ReturnType<typeof loadPrototypeEmbeddings>> }> {
  onProgress('loading-prototypes');
  const embedder = getEmbedder();
  const protos = await loadPrototypeEmbeddings(embedder);
  onProgress('embedding-posts', 0, posts.length);
  const postVecs = await embedder.embedBatch(
    posts.map((p) => p.text),
    (done, total) => onProgress('embedding-posts', done, total),
  );
  return { postVecs, timestamps: posts.map((p) => p.at), protos };
}

/**
 * 全体の診断パイプライン:
 *   1. 投稿 DIAGNOSIS_POST_LIMIT 件取得 (tuning.ts)
 *   2. ONNX 分類器で各投稿 → 8 機能スコア (失敗時は prototype fallback)
 *   3. 時間軸重み付きで合成 → archetype 判定
 *   4. PDS の app.aozoraquest.analysis/self に保存
 */
export async function runDiagnosis(
  agent: Agent,
  onProgress: ProgressCallback = () => {},
): Promise<DiagnosisResult | { insufficient: true; postCount: number }> {
  onProgress('fetching-posts');
  // モバイルは 500 件フルだと Safari のメモリ制限を超えてクラッシュするので
  // 半分に抑える (精度は DIAGNOSIS_MIN_POST_COUNT 以上確保できれば大きく落ちない)。
  const limit = isLowEndDevice() ? 200 : DIAGNOSIS_POST_LIMIT;
  const posts = await fetchMyPosts(agent, limit);

  if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
    return { insufficient: true, postCount: posts.length };
  }

  onProgress('loading-prototypes');
  const onnx = await classifyWithOnnx(posts, onProgress);

  onProgress('analyzing');
  let result: DiagnosisResult | { insufficient: true; postCount: number };
  if (onnx && onnx.perPost.length >= DIAGNOSIS_MIN_POST_COUNT) {
    result = diagnoseFromPerPostScores(
      onnx.perPost,
      onnx.perPost.length,
      new Date(),
      { timestamps: onnx.timestamps },
    );
  } else {
    // ONNX が使えなかった / 日本語 post が足りなかった → prototype fallback
    const { postVecs, timestamps, protos } = await classifyWithPrototype(posts, onProgress);
    result = diagnose(postVecs, protos, posts.length, new Date(), { timestamps });
  }

  if ('insufficient' in result) return result;

  onProgress('saving');

  // 既存レコード (あれば) を読み込んで playerLevel / jobLevel を引き継ぐ。
  const existing = await getRecord<DiagnosisResult>(agent, agent.assertDid ?? '', 'app.aozoraquest.analysis', 'self')
    .catch(() => null);
  const playerLevel = existing?.playerLevel ?? { xp: 0, streakDays: 0 };

  // ユーザーが過去に「転職」で選んだ archetype (jobLevel.archetype) があり、
  // 新しい診断結果がそれと異なる場合は、ユーザーの選択を優先し、新候補は
  // pendingArchetype として提示する。これがないと診断を走らせる度に「転職前
  // の職業に戻ってしまう」ことになる。
  const userChosenArchetype = existing?.jobLevel?.archetype;
  const suggestedArchetype = result.archetype;
  const divergent = userChosenArchetype && userChosenArchetype !== suggestedArchetype;

  const finalArchetype = divergent ? userChosenArchetype : suggestedArchetype;
  const jobLevel =
    existing?.jobLevel && existing.jobLevel.archetype === finalArchetype
      ? existing.jobLevel
      : { archetype: finalArchetype, xp: 0, joinedAt: result.analyzedAt };

  // divergent 時の pending 扱い: 既存の streak が同じ候補を指していれば +1、
  // 別候補なら 1 にリセット。一致時 (divergent でない) は pending をクリア。
  const record: DiagnosisResult = {
    archetype: finalArchetype,
    rpgStats: result.rpgStats,
    cognitiveScores: result.cognitiveScores,
    confidence: result.confidence,
    analyzedPostCount: result.analyzedPostCount,
    analyzedAt: result.analyzedAt,
    jobLevel,
    playerLevel,
  };
  if (divergent) {
    record.pendingArchetype = suggestedArchetype;
    const prev = existing?.pendingArchetype === suggestedArchetype
      ? existing.pendingArchetypeStreak ?? 0
      : 0;
    record.pendingArchetypeStreak = prev + 1;
  }

  await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
    ...record,
    public: false,
  });

  onProgress('done');
  return record;
}

/**
 * 他ユーザーの気質を推し量る。PDS には一切書き込まず、戻り値のみ。
 * runDiagnosis と同じ ONNX → prototype fallback の順で判定する。
 *
 * options.postLimit: 取得する投稿の最大件数 (デフォルト DIAGNOSIS_POST_LIMIT)。
 * 相性ランキング用の軽量診断では 150 程度に抑え per-user レイテンシを短縮する。
 */
export async function runDiagnosisForOther(
  agent: Agent,
  actor: string,
  onProgress: ProgressCallback = () => {},
  options: { postLimit?: number } = {},
): Promise<DiagnosisResult | { insufficient: true; postCount: number }> {
  const postLimit = options.postLimit ?? DIAGNOSIS_POST_LIMIT;
  onProgress('fetching-posts');
  const posts = await fetchUserPostsForDiagnosis(agent, actor, postLimit);
  return await diagnoseGivenPosts(posts, onProgress);
}

/**
 * 既に取得済の投稿配列を受けて診断する (ネットワーク I/O と推論の分離版)。
 * 相性ランキングの裏診断で、次ユーザー分の posts を並列 prefetch しつつ
 * ONNX は 1 人ずつ直列消費する pipeline を作るために公開している。
 */
export async function diagnoseGivenPosts(
  posts: { text: string; at: string }[],
  onProgress: ProgressCallback = () => {},
): Promise<DiagnosisResult | { insufficient: true; postCount: number }> {
  if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
    return { insufficient: true, postCount: posts.length };
  }
  onProgress('loading-prototypes');
  const onnx = await classifyWithOnnx(posts, onProgress);

  onProgress('analyzing');
  let result: DiagnosisResult | { insufficient: true; postCount: number };
  if (onnx && onnx.perPost.length >= DIAGNOSIS_MIN_POST_COUNT) {
    result = diagnoseFromPerPostScores(
      onnx.perPost,
      onnx.perPost.length,
      new Date(),
      { timestamps: onnx.timestamps },
    );
  } else {
    const { postVecs, timestamps, protos } = await classifyWithPrototype(posts, onProgress);
    result = diagnose(postVecs, protos, posts.length, new Date(), { timestamps });
  }
  if ('insufficient' in result) return result;

  onProgress('done');
  return result;
}
