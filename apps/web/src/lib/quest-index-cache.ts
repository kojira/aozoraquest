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

export async function getQuestIndexCached(): Promise<QuestIndex> {
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.index;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const index = await fetchQuestIndex();
      cached = { index, ts: Date.now() };
      return index;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** リフレッシュ操作用: キャッシュを捨てて取り直す */
export async function refreshQuestIndex(): Promise<QuestIndex> {
  cached = null;
  return getQuestIndexCached();
}

/** テスト用 */
export function clearQuestIndexCache(): void {
  cached = null;
  inflight = null;
}
