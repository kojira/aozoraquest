/**
 * fetchQuestIndex の共有キャッシュ (docs/16-multicolumn.md §データ取得の重複防止)。
 *
 * board カラムを複数並べたり、route の /board と workspace の board カラムが
 * 同時に mount されても、index の fetch は TTL 内 1 回に抑える。
 */
import { fetchQuestIndex, type QuestIndex } from './quest-api';

const TTL_MS = 30_000;

let cached: { index: QuestIndex; ts: number } | null = null;
let inflight: Promise<QuestIndex> | null = null;
/** 直近に使った builder を覚え、refresh 時に同じ経路で取り直す。 */
let lastBuilder: (() => Promise<QuestIndex>) | null = null;

/**
 * questIndex を取得 (TTL 30s キャッシュ + inflight 共有)。
 *
 * builder を渡すとそれで取得する。集約 Worker が未デプロイのとき、
 * board が「発見ディレクトリからのクライアント集約」
 * (buildQuestIndexFromDirectory) を builder として注入することで、
 * quest が発行者以外にも見えるようにする。未指定なら直近 builder か
 * fetchQuestIndex (Worker or mock) に落ちる。
 */
export async function getQuestIndexCached(builder?: () => Promise<QuestIndex>): Promise<QuestIndex> {
  if (builder) lastBuilder = builder;
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.index;
  if (inflight) return inflight;
  const fetcher = builder ?? lastBuilder ?? fetchQuestIndex;
  inflight = (async () => {
    try {
      const index = await fetcher();
      cached = { index, ts: Date.now() };
      return index;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** リフレッシュ操作用: キャッシュを捨てて取り直す (直近の builder を踏襲) */
export async function refreshQuestIndex(): Promise<QuestIndex> {
  cached = null;
  return getQuestIndexCached();
}

/** テスト用 */
export function clearQuestIndexCache(): void {
  cached = null;
  inflight = null;
  lastBuilder = null;
}
