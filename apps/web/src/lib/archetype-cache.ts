/**
 * DID → Archetype のメモリキャッシュと React フック。
 *
 * - 未取得 (undefined) / 取得済み無し (null) / 取得済み済み (Archetype) を区別
 * - TTL 30 分
 * - 同じ DID を並行で fetch しないように inflight を共有
 */

import { useEffect, useMemo, useState } from 'react';
import type { Agent } from '@atproto/api';
import type { Archetype, DiagnosisResult } from '@aozoraquest/core';
import { ARCHETYPE_CACHE_TTL_MS, JOBS_BY_ID } from '@aozoraquest/core';
import { getRecord } from './atproto';
import { ROOT_COL } from './collections';

interface CacheEntry {
  archetype: Archetype | null;
  fetchedAt: number;
}

const TTL_MS = ARCHETYPE_CACHE_TTL_MS;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<Archetype | null>>();

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && Date.now() - entry.fetchedAt < TTL_MS;
}

async function fetchOne(agent: Agent, did: string): Promise<Archetype | null> {
  const existing = inflight.get(did);
  if (existing) return existing;
  const p = (async () => {
    try {
      // 他人の analysis は production NSID から (env 隔離は self 用)
      const r = await getRecord<DiagnosisResult>(agent, did, ROOT_COL.analysis, 'self');
      const a = r?.archetype;
      const valid = a && a in JOBS_BY_ID ? (a as Archetype) : null;
      cache.set(did, { archetype: valid, fetchedAt: Date.now() });
      return valid;
    } catch {
      cache.set(did, { archetype: null, fetchedAt: Date.now() });
      return null;
    } finally {
      inflight.delete(did);
    }
  })();
  inflight.set(did, p);
  return p;
}

/** フックで DIDs → archetype map を得る。未取得分は裏で fetch、state を更新。 */
export function useArchetypes(agent: Agent | null, dids: readonly string[]): Map<string, Archetype | null> {
  // dids の並びは不定なので key にはソート済み文字列を使う
  const key = useMemo(() => [...new Set(dids)].sort().join(','), [dids]);

  const [, tick] = useState(0);

  useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    const unique = [...new Set(dids)];
    const missing = unique.filter((d) => !isFresh(cache.get(d)));
    if (missing.length === 0) return;
    Promise.allSettled(missing.map((d) => fetchOne(agent, d))).then(() => {
      if (!cancelled) tick((n) => n + 1);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, key]);

  const map = useMemo(() => {
    const m = new Map<string, Archetype | null>();
    for (const d of dids) {
      const entry = cache.get(d);
      m.set(d, isFresh(entry) ? entry.archetype : null);
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

/** 手動で 1 件キャッシュに入れる (自分の analysis が手元にあるとき用) */
export function seedArchetype(did: string, archetype: Archetype | null) {
  cache.set(did, { archetype, fetchedAt: Date.now() });
}
