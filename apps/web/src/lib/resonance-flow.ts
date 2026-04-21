/**
 * 共鳴タイムライン: 管理者 PDS のディレクトリに登録された DID から
 * 直近投稿を取り、自分との共鳴度 (もしくは単純に時系列) で並べる。
 *
 * - 自分の診断と相手の診断が揃えば resonance (0.6*sim + 0.4*compl) で並べる
 * - 揃わなければ createdAt の新しい順で並べる (diagnosis gating のため)
 */

import type { Agent, AppBskyFeedDefs } from '@atproto/api';
import type { Archetype, DiagnosisResult, StatArray, StatVector } from '@aozoraquest/core';
import { JOBS_BY_ID, resonance, resonanceTimelineScore } from '@aozoraquest/core';
import { fetchAuthorFeed, getRecord } from './atproto';
import { seedArchetype } from './archetype-cache';

export interface ResonanceEntry {
  item: AppBskyFeedDefs.FeedViewPost;
  did: string;
  score: number | null; // null = 相手が未診断 or 自分が未診断
  similarity: number | null;
  complementarity: number | null;
  theirArchetype: Archetype | null;
}

export interface BuildResonanceOptions {
  selfDiagnosis: DiagnosisResult | null;
  directoryDids: string[];
  perAuthorLimit?: number;
  maxAuthors?: number;
}

export async function buildResonanceTimeline(
  agent: Agent,
  opts: BuildResonanceOptions,
): Promise<ResonanceEntry[]> {
  const { selfDiagnosis, directoryDids } = opts;
  const perAuthor = opts.perAuthorLimit ?? 5;
  const maxAuthors = opts.maxAuthors ?? 30;
  const dids = directoryDids.slice(0, maxAuthors);
  if (dids.length === 0) return [];

  const selfArr = selfDiagnosis ? toStatArray(selfDiagnosis.rpgStats) : null;

  const results = await Promise.all(
    dids.map(async (did) => {
      try {
        const [feed, otherDiag] = await Promise.all([
          fetchAuthorFeed(agent, did, perAuthor),
          getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self'),
        ]);
        let score: number | null = null;
        let sim: number | null = null;
        let comp: number | null = null;
        if (selfArr && otherDiag?.rpgStats) {
          const d = resonance(selfArr, toStatArray(otherDiag.rpgStats));
          score = d.score;
          sim = d.similarity;
          comp = d.complementarity;
        }
        const theirArchetype: Archetype | null =
          otherDiag?.archetype && otherDiag.archetype in JOBS_BY_ID
            ? (otherDiag.archetype as Archetype)
            : null;
        // ついでに archetype キャッシュにも投入
        seedArchetype(did, theirArchetype);
        return feed.map<ResonanceEntry>((item) => ({
          item,
          did,
          score,
          similarity: sim,
          complementarity: comp,
          theirArchetype,
        }));
      } catch (e) {
        console.warn('resonance author fetch failed', did, e);
        return [] as ResonanceEntry[];
      }
    }),
  );

  const now = Date.now();
  const all = results.flat();
  all.sort((a, b) => {
    const sa = rankScore(a, now);
    const sb = rankScore(b, now);
    return sb - sa;
  });
  return all;
}

function rankScore(e: ResonanceEntry, now: number): number {
  const age = Math.max(0, now - postTime(e.item));
  if (e.score == null) {
    // 未診断なら純粋に新しさだけで並べる (古いほど小さい)
    return -age;
  }
  return resonanceTimelineScore(e.score, age);
}

function postTime(item: AppBskyFeedDefs.FeedViewPost): number {
  const r = item.post.record as { createdAt?: string };
  if (!r.createdAt) return 0;
  const t = Date.parse(r.createdAt);
  return Number.isFinite(t) ? t : 0;
}

function toStatArray(s: StatVector): StatArray {
  return [s.atk, s.def, s.agi, s.int, s.luk] as const;
}
