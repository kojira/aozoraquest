/**
 * **職ごとの累計 XP を権威 state から読む共有キャッシュ hook** (#534)。
 *
 * XP の記録先は `GameState.jobXp[archetype]` に一本化した (投稿・デイリークエスト・
 * 依頼クエスト・戦闘のすべて)。`analysis.jobLevel.xp` はベータ期間の記録として凍結され、
 * もう成長には効かない。**LV を表示する画面はすべてここを読む** — 片方だけ analysis を
 * 見ていると「サーバーが数えたレベルと画面のレベルが食い違う」という最悪の壊れ方をする。
 *
 * 実装は `use-self-diagnosis` と同じ流儀 (module キャッシュ + inflight dedup + 購読)。
 * 複数カラムが同時 mount しても edge への往復は 1 回で済む。
 */
import { useEffect, useReducer } from 'react';
import type { Agent } from '@atproto/api';
import { serverState, worldServerEnabled } from './world-server';
import { useSession } from './session';

type JobXpMap = Record<string, number>;

interface CacheState {
  did: string;
  /** null = 取得に失敗した (サーバー未設定・通信断)。空オブジェクトとは区別する。 */
  jobXp: JobXpMap | null;
}

let cached: CacheState | null = null;
let inflight: Promise<JobXpMap | null> | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) {
    try { fn(); } catch { /* no-op */ }
  }
}

async function fetchAndCache(agent: Agent, did: string): Promise<JobXpMap | null> {
  try {
    const { state } = await serverState(agent);
    cached = { did, jobXp: state.jobXp ?? {} };
    return cached.jobXp;
  } catch (e) {
    console.warn('server jobXp load failed', e);
    // **失敗を 0 に丸めない。** 丸めると「通信が切れた瞬間に全員 Lv1 に見える」ことになる。
    // 呼び出し側は `loaded && jobXp === null` を「まだ分からない」として扱う。
    cached = { did, jobXp: null };
    return null;
  } finally {
    inflight = null;
    notify();
  }
}

export function loadJobXp(agent: Agent, did: string): Promise<JobXpMap | null> {
  if (cached?.did === did) return Promise.resolve(cached.jobXp);
  if (inflight) return inflight;
  inflight = fetchAndCache(agent, did);
  return inflight;
}

/** キャッシュを捨てて取り直す (投稿後・戦闘後に XP が増えたとき)。全購読者に伝播する。 */
export function refreshJobXp(agent: Agent, did: string): Promise<JobXpMap | null> {
  cached = null;
  inflight = fetchAndCache(agent, did);
  return inflight;
}

/** テスト用: キャッシュ初期化 */
export function clearJobXpCache(): void {
  cached = null;
  inflight = null;
}

export interface JobXpState {
  /** 職 → 累計 XP。null は「まだ分からない」(未取得 or 取得失敗)。 */
  jobXp: JobXpMap | null;
  /** fetch が settle したか (null でも「取れなかった」と確定した状態を区別する)。 */
  loaded: boolean;
}

export function useJobXp(): JobXpState {
  const session = useSession();
  const [, force] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    subscribers.add(force);
    return () => { subscribers.delete(force); };
  }, []);

  const did = session.did ?? null;
  useEffect(() => {
    if (!session.agent || !did || !worldServerEnabled) return;
    void loadJobXp(session.agent, did);
  }, [session.agent, did]);

  if (!did || cached?.did !== did) return { jobXp: null, loaded: false };
  return { jobXp: cached.jobXp, loaded: true };
}

/** その職の累計 XP。まだ分からない / その職で稼いでいなければ 0。 */
export function xpOfJob(jobXp: JobXpMap | null, archetype: string | null | undefined): number {
  if (!jobXp || !archetype) return 0;
  const v = jobXp[archetype];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
