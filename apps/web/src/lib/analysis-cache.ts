/**
 * DID → DiagnosisResult のメモリキャッシュ。
 *
 * archetype-cache.ts は archetype だけを返すが、相性ランキングでは
 * cognitiveScores / rpgStats も必要 (resonance 計算に 8 軸が要る) なので
 * 丸ごと DiagnosisResult を保持する別キャッシュを用意する。
 *
 * - 未取得 (undefined) / PDS にレコード無し (null) / 取得済 (DiagnosisResult) を区別
 * - TTL 30 分 (ARCHETYPE_CACHE_TTL_MS と同値)
 * - 同じ DID を並行 fetch しないよう inflight 共有
 */

import type { Agent } from '@atproto/api';
import type { DiagnosisResult } from '@aozoraquest/core';
import { ARCHETYPE_CACHE_TTL_MS } from '@aozoraquest/core';
import { getRecord } from './atproto';
import { ROOT_COL } from './collections';

interface CacheEntry {
  analysis: DiagnosisResult | null;
  fetchedAt: number;
}

const TTL_MS = ARCHETYPE_CACHE_TTL_MS;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<DiagnosisResult | null>>();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && Date.now() - entry.fetchedAt < TTL_MS;
}

export async function getAnalysis(agent: Agent, did: string): Promise<DiagnosisResult | null> {
  const entry = cache.get(did);
  if (isFresh(entry)) return entry.analysis;
  const existing = inflight.get(did);
  if (existing) return existing;
  const p = (async () => {
    try {
      // 他人の analysis は production NSID から (env 隔離は self 用)
      const r = await getRecord<DiagnosisResult>(agent, did, ROOT_COL.analysis, 'self');
      cache.set(did, { analysis: r ?? null, fetchedAt: Date.now() });
      return r ?? null;
    } catch {
      cache.set(did, { analysis: null, fetchedAt: Date.now() });
      return null;
    } finally {
      inflight.delete(did);
    }
  })();
  inflight.set(did, p);
  return p;
}

/** 自分の analysis を手元に持っているときに seed する。 */
export function seedAnalysis(did: string, analysis: DiagnosisResult | null): void {
  cache.set(did, { analysis, fetchedAt: Date.now() });
}
