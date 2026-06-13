/**
 * 自分の気質診断 (app.aozoraquest.analysis/self) の共有キャッシュ hook。
 *
 * home / bar など複数カラムが同時 mount するようになった (PR #33) ため、
 * 各カラムが個別に getRecord すると同一 record を重複 fetch し、
 * 投稿後の更新 (useOnPosted → refresh) も他カラムへ伝播しない。
 * module-level のキャッシュ + 購読で一本化する。
 *
 * - did 単位でキャッシュ (アカウント切替で取り直す)
 * - inflight dedup (同時 mount で fetch は 1 回)
 * - refreshSelfDiagnosis() で全購読者に更新が伝播する
 */
import { useEffect, useReducer } from 'react';
import type { Agent } from '@atproto/api';
import type { Archetype, DiagnosisResult } from '@aozoraquest/core';
import { JOBS_BY_ID } from '@aozoraquest/core';
import { getRecord } from './atproto';
import { COL } from './collections';
import { seedArchetype } from './archetype-cache';
import { useSession } from './session';

interface CacheState {
  did: string;
  diag: DiagnosisResult | null;
}

let cached: CacheState | null = null;
let inflight: Promise<DiagnosisResult | null> | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) {
    try { fn(); } catch {/* no-op */}
  }
}

async function fetchAndCache(agent: Agent, did: string): Promise<DiagnosisResult | null> {
  try {
    const diag = await getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self');
    cached = { did, diag };
    // 自分の archetype を共有キャッシュにも seed しておく (旧 home.tsx と同じ)
    const a = diag?.archetype && diag.archetype in JOBS_BY_ID ? (diag.archetype as Archetype) : null;
    seedArchetype(did, a);
    return diag;
  } catch (e) {
    console.warn('self analysis load failed', e);
    // 失敗も「確定」として扱う (= null で settle。リトライは refresh 経由)
    cached = { did, diag: null };
    return null;
  } finally {
    inflight = null;
    notify();
  }
}

export function loadSelfDiagnosis(agent: Agent, did: string): Promise<DiagnosisResult | null> {
  if (cached?.did === did) return Promise.resolve(cached.diag);
  if (inflight) return inflight;
  inflight = fetchAndCache(agent, did);
  return inflight;
}

/** キャッシュを捨てて取り直す (投稿後の rpgStats 更新など)。全購読者に伝播する。 */
export function refreshSelfDiagnosis(agent: Agent, did: string): Promise<DiagnosisResult | null> {
  cached = null;
  inflight = fetchAndCache(agent, did);
  return inflight;
}

/** テスト用: キャッシュ初期化 */
export function clearSelfDiagnosisCache(): void {
  cached = null;
  inflight = null;
}

export interface SelfDiagnosis {
  diag: DiagnosisResult | null;
  /** fetch が settle した (= null でも「診断なし」と確定した) かどうか。
   *  共鳴 TL のように「診断の有無で結果が変わる重い処理」は loaded を
   *  待ってから 1 回だけ実行すること。 */
  loaded: boolean;
}

export function useSelfDiagnosis(): SelfDiagnosis {
  const session = useSession();
  const [, force] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    subscribers.add(force);
    return () => { subscribers.delete(force); };
  }, []);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    void loadSelfDiagnosis(session.agent, session.did);
  }, [session.status, session.agent, session.did]);

  const loaded = session.status === 'signed-in' && cached?.did === session.did;
  return { diag: loaded ? (cached?.diag ?? null) : null, loaded };
}
