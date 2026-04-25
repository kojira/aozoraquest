/**
 * 共鳴タイムライン: 管理者 PDS のディレクトリに登録された DID から
 * 直近投稿を取り、createdAt の新しい順に並べる。共鳴スコアは表示の
 * バッジに使うが並び順には影響しない (純粋な時系列タイムライン)。
 *
 * 自分の DID は除外する (resonance=1.0 で常に top に張り付く問題を回避)。
 */

import type { Agent, AppBskyFeedDefs } from '@atproto/api';
import type { Archetype, DiagnosisResult, StatArray, StatVector } from '@aozoraquest/core';
import { JOBS_BY_ID, resonance } from '@aozoraquest/core';
import { fetchAuthorFeed, getRecord } from './atproto';
import { seedArchetype } from './archetype-cache';
import { ROOT_COL } from './collections';

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
  /** 自分の DID。指定されれば directoryDids から除外する。 */
  selfDid?: string | undefined;
  directoryDids: string[];
  perAuthorLimit?: number;
  maxAuthors?: number;
}

export async function buildResonanceTimeline(
  agent: Agent,
  opts: BuildResonanceOptions,
): Promise<ResonanceEntry[]> {
  const { selfDiagnosis, directoryDids, selfDid } = opts;
  const perAuthor = opts.perAuthorLimit ?? 5;
  const maxAuthors = opts.maxAuthors ?? 30;
  const dids = directoryDids
    .filter((d) => d !== selfDid)
    .slice(0, maxAuthors);
  if (dids.length === 0) return [];

  const selfArr = selfDiagnosis ? toStatArray(selfDiagnosis.rpgStats) : null;

  const results = await Promise.all(
    dids.map(async (did) => {
      try {
        const [feedRaw, otherDiag] = await Promise.all([
          fetchAuthorFeed(agent, did, perAuthor),
          // 他人の analysis は production NSID から読む (env 隔離は self 用)
          getRecord<DiagnosisResult>(agent, did, ROOT_COL.analysis, 'self'),
        ]);
        // リポストを除外。getAuthorFeed は post 本人 + リポストを返すので、
        // 本人投稿だけに絞らないと directory に居ない他人の post が混入する。
        const feed = feedRaw.filter((item) => item.post.author.did === did);
        let score: number | null = null;
        let sim: number | null = null;
        let comp: number | null = null;
        const theirArchetype: Archetype | null =
          otherDiag?.archetype && otherDiag.archetype in JOBS_BY_ID
            ? (otherDiag.archetype as Archetype)
            : null;
        const myArchetype: Archetype | null =
          selfDiagnosis?.archetype && selfDiagnosis.archetype in JOBS_BY_ID
            ? (selfDiagnosis.archetype as Archetype)
            : null;
        if (selfArr && otherDiag?.rpgStats) {
          const d = (myArchetype && theirArchetype)
            ? resonance(selfArr, toStatArray(otherDiag.rpgStats), myArchetype, theirArchetype)
            : resonance(selfArr, toStatArray(otherDiag.rpgStats));
          score = d.score;
          sim = d.similarity;
          comp = d.complementarity;
        }
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

  // createdAt 降順 (新しい順)
  const all = results.flat();
  all.sort((a, b) => postTime(b.item) - postTime(a.item));
  return all;
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
