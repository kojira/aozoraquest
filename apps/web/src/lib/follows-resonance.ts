/**
 * フォロー中のユーザーに対して「直近 7 日以内に投稿」× 「相性計算に必要な
 * DiagnosisResult」を集め、自分との相性 (resonance) ランキングを作る。
 *
 * 2 段階で埋める:
 *  1. PDS に analysis レコードがある人は即時使う (AozoraQuest 利用者)
 *  2. 残り (未利用者) は IDB キャッシュを確認、無ければ ONNX で軽量診断 (150 posts)
 *     → IDB に保存。ONNX worker は singleton なので順次実行、完了分を progressive
 *     にランキングへ差し込む。
 */

import { AtpAgent, type Agent } from '@atproto/api';
import type { ArchetypePairRelation, Archetype, DiagnosisResult } from '@aozoraquest/core';
import { DIAGNOSIS_MIN_POST_COUNT, resonance, resonanceLabel, statVectorToArray } from '@aozoraquest/core';
import { fetchFollows, fetchLatestPostAt, fetchUserPostsForDiagnosis, type FollowProfile, type DiagnosisPost } from './atproto';
import { getAnalysis } from './analysis-cache';
import { loadCachedAnalysis, saveCachedAnalysis } from './analysis-idb';
import { diagnoseGivenPosts } from './diagnosis-flow';

/**
 * 他人の公開投稿を読むときは認証済 agent を使わず、公開 AppView に直接叩く。
 * 理由:
 *  1. 認証済 agent は user の PDS (例: puffball.us-east.host.bsky.network) 経由で
 *     DPoP 認証する必要があり、並列発火で nonce が競合する & PDS 側の CORS
 *     preflight が不安定になる (実測で ~1 時間で Failed to fetch 連発)
 *  2. api.bsky.app (公式 AppView) は匿名アクセス可、CORS 正常、DPoP なしで高速
 *  3. getAuthorFeed / getProfile で読む情報は公開データなので認証不要
 */
let _publicAgent: AtpAgent | null = null;
function getPublicAgent(): AtpAgent {
  if (!_publicAgent) _publicAgent = new AtpAgent({ service: 'https://api.bsky.app' });
  return _publicAgent;
}

/** 直近 7 日 (相性ランキングの「活発」定義)。 */
export const RECENCY_DAYS = 7;
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

/** 同時並列で走らせる API 呼び出し数 (follow / recency / analysis で使う)。 */
const CONCURRENCY = 10;

/** 裏診断時の post 取得並列度。ONNX は singleton で直列だが、次の N 人分の
 * 投稿を先取りしておいて推論待ち時間に被せる (pipeline)。 */
const PREFETCH_CONCURRENCY = 5;

/** 裏診断の軽量モード: fetch する投稿数。相性ランキングでは archetype/stats の
 * 大まかな傾向が分かれば十分なので 100 posts で打ち切る。これで API 取得も推論も
 * 最短 (/me の 500 より 5x 速い)。 */
const LIGHT_POST_LIMIT = 100;

export type ResonanceRankPhase = 'follows' | 'recency' | 'analysis' | 'scoring' | 'diagnosing';
export type ResonanceSource = 'pds' | 'idb' | 'onnx';

export interface ResonanceRankEntry {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  archetype: Archetype;
  score: number;          // 0-1
  scorePercent: number;   // 0-100 表示用
  label: string;          // 言語ラベル
  latestPostAt: string;   // ISO
  pairRelation: ArchetypePairRelation;
  /** 診断結果の入手経路 (UI で内訳表示したいとき用) */
  source: ResonanceSource;
}

export interface ResonanceRankStats {
  totalFollows: number;
  recentlyActive: number;
  pdsAnalyzed: number;
  idbCached: number;
  freshlyDiagnosed: number;
  skippedInsufficient: number;
  pendingDiagnoses: number;
}

export interface ResonanceRankProgress {
  (ev:
    | { phase: 'follows' | 'recency' | 'analysis' | 'scoring'; done: number; total: number }
    | { phase: 'diagnosing'; done: number; total: number; currentHandle?: string }
    | { phase: 'partial'; ranking: ResonanceRankEntry[]; stats: ResonanceRankStats }
  ): void;
}

export interface ResonanceRankResult {
  ranking: ResonanceRankEntry[];
  stats: ResonanceRankStats;
}

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

interface Candidate {
  profile: FollowProfile;
  latestAt: string;
}

function entryFromAnalysis(
  myAnalysis: DiagnosisResult,
  candidate: Candidate,
  analysis: DiagnosisResult,
  source: ResonanceSource,
): ResonanceRankEntry | null {
  if (!analysis.archetype || !analysis.rpgStats) return null;
  const detail = resonance(
    statVectorToArray(myAnalysis.rpgStats),
    statVectorToArray(analysis.rpgStats),
    myAnalysis.archetype,
    analysis.archetype,
  );
  if (!detail.pairRelation) return null;
  const score = Math.max(0, Math.min(1, detail.score));
  const { profile, latestAt } = candidate;
  return {
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
    source,
  };
}

/**
 * 相性ランキングを段階的に構築する。
 * progressive で top-up しながら最終的な ResonanceRankResult を返す。
 *
 * 中断可能にしたい場合は cancelled() が true を返すよう渡せば、
 * 裏診断ループを各イテレーションで抜ける。
 */
export async function computeFollowResonanceRanking(
  agent: Agent,
  myDid: string,
  myAnalysis: DiagnosisResult,
  onProgress?: ResonanceRankProgress,
  cancelled: () => boolean = () => false,
): Promise<ResonanceRankResult> {
  // ── Phase 1: follow 一覧 ───────────────────────────────
  onProgress?.({ phase: 'follows', done: 0, total: 1 });
  const allFollows = await fetchFollows(agent, myDid);
  // 稀に getFollows が自分自身を含むケースがあるので防御的に除外
  const follows = allFollows.filter((f) => f.did !== myDid);
  onProgress?.({ phase: 'follows', done: 1, total: 1 });
  if (cancelled()) return { ranking: [], stats: emptyStats(follows.length) };

  // ── Phase 2: recency filter (並列 10、公開 AppView 経由) ─────
  const pub = getPublicAgent() as unknown as Agent; // AtpAgent は Agent 互換
  const cutoff = Date.now() - RECENCY_MS;
  const latestAts = await parallelMap(
    follows,
    CONCURRENCY,
    (f) => fetchLatestPostAt(pub, f.did),
    (d, t) => onProgress?.({ phase: 'recency', done: d, total: t }),
  );
  const candidates: Candidate[] = [];
  for (let i = 0; i < follows.length; i++) {
    const at = latestAts[i];
    if (!at) continue;
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) continue;
    if (ms >= cutoff) candidates.push({ profile: follows[i]!, latestAt: at });
  }
  if (cancelled()) return { ranking: [], stats: { ...emptyStats(follows.length), recentlyActive: candidates.length } };

  // ── Phase 3: PDS analysis を並列取得 ───────────────────
  const pdsAnalyses = await parallelMap(
    candidates,
    CONCURRENCY,
    ({ profile }) => getAnalysis(agent, profile.did),
    (d, t) => onProgress?.({ phase: 'analysis', done: d, total: t }),
  );

  // PDS 由来のランキング行を作る + 残った (PDS なし) 候補を裏診断キューへ
  const ranking: ResonanceRankEntry[] = [];
  const unanalyzed: Candidate[] = [];
  let pdsAnalyzed = 0;
  for (let i = 0; i < candidates.length; i++) {
    const a = pdsAnalyses[i];
    const cand = candidates[i]!;
    if (a) {
      const entry = entryFromAnalysis(myAnalysis, cand, a, 'pds');
      if (entry) { ranking.push(entry); pdsAnalyzed++; }
    } else {
      unanalyzed.push(cand);
    }
  }
  ranking.sort((a, b) => b.score - a.score);

  let idbCached = 0;
  let freshlyDiagnosed = 0;
  let skippedInsufficient = 0;

  const buildStats = (): ResonanceRankStats => ({
    totalFollows: follows.length,
    recentlyActive: candidates.length,
    pdsAnalyzed,
    idbCached,
    freshlyDiagnosed,
    skippedInsufficient,
    pendingDiagnoses: Math.max(0, unanalyzed.length - (idbCached + freshlyDiagnosed + skippedInsufficient)),
  });

  onProgress?.({ phase: 'scoring', done: candidates.length, total: candidates.length });
  onProgress?.({ phase: 'partial', ranking: [...ranking], stats: buildStats() });

  if (cancelled()) return { ranking, stats: buildStats() };

  // ── Phase 4: 裏診断 (IDB → 無ければ ONNX 軽量診断) ────
  // まず IDB hit を一斉に処理 (並列 OK、ONNX は使わない)。
  // 残りは fetch pipeline: PREFETCH_CONCURRENCY 並列で posts を先取り、
  // 完了したものから ONNX 推論 (singleton なので直列消費)。
  // これで fetch 待ち時間を ONNX 実行に被せられる。

  interface DiagnoseJob {
    cand: Candidate;
    /** 成功: DiagnosisPost[] / 失敗: throw (= 次回再挑戦、IDB に null は書かない)。 */
    postsPromise: Promise<DiagnosisPost[]>;
  }
  const onnxJobs: DiagnoseJob[] = [];

  for (let i = 0; i < unanalyzed.length; i++) {
    if (cancelled()) break;
    const cand = unanalyzed[i]!;
    const cached = await loadCachedAnalysis(cand.profile.did);
    if (cached !== undefined) {
      if (cached === null) {
        skippedInsufficient++;
      } else {
        const entry = entryFromAnalysis(myAnalysis, cand, cached, 'idb');
        if (entry) { ranking.push(entry); idbCached++; } else { skippedInsufficient++; }
      }
      continue;
    }
    onnxJobs.push({ cand, postsPromise: Promise.resolve([] as DiagnosisPost[]) });
  }
  ranking.sort((a, b) => b.score - a.score);
  onProgress?.({ phase: 'partial', ranking: [...ranking], stats: buildStats() });

  if (cancelled() || onnxJobs.length === 0) {
    onProgress?.({ phase: 'diagnosing', done: 0, total: 0 });
    return { ranking, stats: buildStats() };
  }

  // fetch pipeline: 並列 prefetch + 直列 ONNX 消費
  // postsPromise を semaphore 付きで発火させる (開始時点で最大 PREFETCH_CONCURRENCY 本)
  let fetchActive = 0;
  let fetchCursor = 0;
  const fetchPool: Array<() => void> = [];

  const acquireFetch = (): Promise<void> => {
    if (fetchActive < PREFETCH_CONCURRENCY) { fetchActive++; return Promise.resolve(); }
    return new Promise((resolve) => { fetchPool.push(() => { fetchActive++; resolve(); }); });
  };
  const releaseFetch = () => {
    fetchActive--;
    const next = fetchPool.shift();
    if (next) next();
  };

  const startFetch = (job: DiagnoseJob) => {
    job.postsPromise = (async () => {
      await acquireFetch();
      try {
        // 公開 AppView を使う (認証済 PDS だと並列 DPoP で CORS preflight が落ちる)
        return await fetchUserPostsForDiagnosis(pub, job.cand.profile.did, LIGHT_POST_LIMIT);
      } finally {
        releaseFetch();
      }
    })();
    // unhandled rejection を抑えるための no-op handler (実際の処理は await 側で)
    job.postsPromise.catch(() => {});
  };

  // 先頭 PREFETCH_CONCURRENCY 件の fetch を即発火
  const primeCount = Math.min(PREFETCH_CONCURRENCY, onnxJobs.length);
  for (let k = 0; k < primeCount; k++) { startFetch(onnxJobs[k]!); fetchCursor++; }

  // ONNX は順番に消費。1 件終わるたびに次の fetch を発火
  for (let i = 0; i < onnxJobs.length; i++) {
    if (cancelled()) break;
    const job = onnxJobs[i]!;
    const { cand } = job;

    // fetch が未発火なら発火 (起きにくいが安全弁)
    if (!job.postsPromise) startFetch(job);
    onProgress?.({ phase: 'diagnosing', done: i, total: onnxJobs.length, currentHandle: cand.profile.handle });

    // 次々の fetch を先取りしておく
    while (fetchCursor < onnxJobs.length && fetchActive < PREFETCH_CONCURRENCY) {
      startFetch(onnxJobs[fetchCursor]!);
      fetchCursor++;
    }

    let posts: DiagnosisPost[];
    try {
      posts = await job.postsPromise;
    } catch (e) {
      // fetch 失敗 (ネットワーク、CORS、一時的 429 など) → IDB には書かず次回リトライさせる
      console.warn('[friends] fetch posts failed (will retry next visit)', cand.profile.handle, e);
      ranking.sort((a, b) => b.score - a.score);
      onProgress?.({ phase: 'partial', ranking: [...ranking], stats: buildStats() });
      continue;
    }

    if (posts.length === 0) {
      // 投稿 0 件は本当に活動がないケース → null キャッシュして OK
      await saveCachedAnalysis(cand.profile.did, null);
      skippedInsufficient++;
      ranking.sort((a, b) => b.score - a.score);
      onProgress?.({ phase: 'partial', ranking: [...ranking], stats: buildStats() });
      continue;
    }

    try {
      const result = await diagnoseGivenPosts(posts);
      if ('insufficient' in result) {
        // posts はあるが文字数足りない等で DIAGNOSIS_MIN_POST_COUNT 未満 → null キャッシュ
        await saveCachedAnalysis(cand.profile.did, null);
        skippedInsufficient++;
      } else {
        await saveCachedAnalysis(cand.profile.did, result);
        const entry = entryFromAnalysis(myAnalysis, cand, result, 'onnx');
        if (entry) { ranking.push(entry); freshlyDiagnosed++; } else { skippedInsufficient++; }
      }
    } catch (e) {
      console.warn('[friends] diagnose failed (will retry next visit)', cand.profile.handle, e);
      // 推論失敗は IDB に書かない (次回リトライ)
    }
    ranking.sort((a, b) => b.score - a.score);
    onProgress?.({ phase: 'partial', ranking: [...ranking], stats: buildStats() });
  }

  onProgress?.({ phase: 'diagnosing', done: onnxJobs.length, total: onnxJobs.length });
  return { ranking, stats: buildStats() };
}

function emptyStats(totalFollows: number): ResonanceRankStats {
  return {
    totalFollows,
    recentlyActive: 0,
    pdsAnalyzed: 0,
    idbCached: 0,
    freshlyDiagnosed: 0,
    skippedInsufficient: 0,
    pendingDiagnoses: 0,
  };
}

// DIAGNOSIS_MIN_POST_COUNT を再エクスポートはしない (使う側は直接 core から import)
void DIAGNOSIS_MIN_POST_COUNT;
