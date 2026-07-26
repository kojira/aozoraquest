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
    // **失敗はキャッシュもしない** — 覚えてしまうと、起動時の一瞬の通信断でセッション中ずっと
    // 「分からない」に固定される。次に誰かが読んだら取り直す。
    cached = null;
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

/**
 * その職の XP を手元のキャッシュに加算する (#534)。戦闘の決着でサーバーが積んだぶんを
 * **往復せずに**反映するため。キャッシュが 2 つに分かれると「戦闘で上げた直後に /me を
 * 開くと戦闘前の LV が出る」ことになるので、画面ごとに state を持たずここに集約する。
 * まだ読めていない (null) ときは何もしない — 差分だけ持っていても絶対値にならない。
 */
export function bumpJobXp(did: string, archetype: string, delta: number): void {
  if (!cached || cached.did !== did || !cached.jobXp || !archetype || delta <= 0) return;
  cached = { did, jobXp: { ...cached.jobXp, [archetype]: (cached.jobXp[archetype] ?? 0) + delta } };
  notify();
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

/**
 * その職の累計 XP。**まだ分からないときは `null`** (未取得 / 取得失敗 / 職が未確定)。
 *
 * 0 を返してはいけない。0 は「その職でまだ稼いでいない = 正真正銘の Lv1」を意味するので、
 * 通信できないことと区別がつかなくなる。**このリリースは全員が本当に Lv1 になる**ので、
 * 障害とリセットが見分けられないと「また消えた」という誤解が確実に起きる。
 * 呼び出し側は null のあいだ LV を出さないこと。
 */
export function xpOfJob(jobXp: JobXpMap | null, archetype: string | null | undefined): number | null {
  if (!jobXp || !archetype) return null;
  const v = jobXp[archetype];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
