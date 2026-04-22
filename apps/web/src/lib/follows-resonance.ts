/**
 * フォロー中のユーザーに対して「直近 7 日以内に投稿」× 「AozoraQuest で診断済」を
 * filter し、自分との相性 (resonance) でランキングを作る。
 *
 * MVP 方針 (plan 参照): ONNX で非利用者を裏診断するのは v2、今は PDS レコードが
 * ある人だけ。計算は API 呼び出しだけで数秒で終わる。
 */

import type { Agent } from '@atproto/api';
import type { ArchetypePairRelation, Archetype, DiagnosisResult } from '@aozoraquest/core';
import { resonance, resonanceLabel, statVectorToArray } from '@aozoraquest/core';
import { fetchFollows, fetchLatestPostAt, type FollowProfile } from './atproto';
import { getAnalysis } from './analysis-cache';

/** 直近 7 日 (相性ランキングの「活発」定義)。 */
export const RECENCY_DAYS = 7;
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

/** 同時並列で走らせる最大数 (API レート配慮)。 */
const CONCURRENCY = 10;

export type ResonanceRankPhase = 'follows' | 'recency' | 'analysis' | 'scoring';

export interface ResonanceRankEntry {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  archetype: Archetype;
  score: number;          // 0-1
  scorePercent: number;   // 0-100 (表示用に round 済)
  label: string;          // 言語ラベル (resonanceLabel)
  latestPostAt: string;   // ISO
  pairRelation: ArchetypePairRelation;
}

export interface ResonanceRankStats {
  totalFollows: number;
  recentlyActive: number;
  analyzed: number;
}

export interface ResonanceRankResult {
  ranking: ResonanceRankEntry[];
  stats: ResonanceRankStats;
}

export type ResonanceRankProgress = (phase: ResonanceRankPhase, done: number, total: number) => void;

/** 配列を並列度 N で map する軽量 pool。 */
async function parallelMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onEach?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const total = items.length;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await fn(items[i]!, i);
      done++;
      onEach?.(done, total);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 相性ランキングの本体。
 * @param myAnalysis 自分の診断結果 (PDS から事前ロード済のものを渡す)
 */
export async function computeFollowResonanceRanking(
  agent: Agent,
  myDid: string,
  myAnalysis: DiagnosisResult,
  onProgress?: ResonanceRankProgress,
): Promise<ResonanceRankResult> {
  // Phase 1: follow 一覧
  onProgress?.('follows', 0, 1);
  const follows = await fetchFollows(agent, myDid);
  onProgress?.('follows', 1, 1);

  // Phase 2: recency filter (並列 10)
  const cutoff = Date.now() - RECENCY_MS;
  const latestAts = await parallelMap(
    follows,
    CONCURRENCY,
    (f) => fetchLatestPostAt(agent, f.did),
    (d, t) => onProgress?.('recency', d, t),
  );
  const active: Array<{ profile: FollowProfile; latestAt: string }> = [];
  for (let i = 0; i < follows.length; i++) {
    const at = latestAts[i];
    if (!at) continue;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    if (ms >= cutoff) active.push({ profile: follows[i]!, latestAt: at });
  }

  // Phase 3: PDS analysis 取得 (並列 10)
  const analyses = await parallelMap(
    active,
    CONCURRENCY,
    ({ profile }) => getAnalysis(agent, profile.did),
    (d, t) => onProgress?.('analysis', d, t),
  );

  // Phase 4: scoring
  onProgress?.('scoring', 0, active.length);
  const myStats = statVectorToArray(myAnalysis.rpgStats);
  const ranking: ResonanceRankEntry[] = [];
  for (let i = 0; i < active.length; i++) {
    const analysis = analyses[i];
    if (!analysis || !analysis.archetype || !analysis.rpgStats) continue;
    const detail = resonance(
      myStats,
      statVectorToArray(analysis.rpgStats),
      myAnalysis.archetype,
      analysis.archetype,
    );
    if (!detail.pairRelation) continue; // archetype 無しルートは今回対象外
    const { profile, latestAt } = active[i]!;
    const score = Math.max(0, Math.min(1, detail.score));
    ranking.push({
      did: profile.did,
      handle: profile.handle,
      ...(profile.displayName ? { displayName: profile.displayName } : {}),
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      archetype: analysis.archetype,
      score,
      scorePercent: Math.round(score * 100),
      label: resonanceLabel(score),
      latestPostAt: latestAt,
      pairRelation: detail.pairRelation,
    });
  }

  ranking.sort((a, b) => b.score - a.score);
  onProgress?.('scoring', active.length, active.length);

  return {
    ranking,
    stats: {
      totalFollows: follows.length,
      recentlyActive: active.length,
      analyzed: ranking.length,
    },
  };
}
