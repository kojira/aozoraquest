/**
 * agent.getProfile の共有キャッシュ (docs/16-multicolumn.md §データ取得の重複防止)。
 *
 * マルチカラム化で同じ profile を複数カラムが同時に開けるようになったため、
 * actor (handle or DID) 単位で inflight dedup + 短い TTL のメモリキャッシュを敷く。
 * localStorage には書かない (プロフィールは鮮度重視、30 秒で十分)。
 *
 * handle-cache.ts (did → handle 解決、24h) とは目的が違う別キャッシュ。
 */
import type { Agent, AppBskyActorDefs } from '@atproto/api';

const TTL_MS = 30_000;

interface Entry {
  profile: AppBskyActorDefs.ProfileViewDetailed;
  ts: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<AppBskyActorDefs.ProfileViewDetailed>>();

/** getProfile の dedup 付きラッパ。30s TTL のメモリキャッシュ。
 *  失敗はキャッシュしない (= 次の呼び出しで再試行する)。 */
export async function getProfileCached(
  agent: Agent,
  actor: string,
): Promise<AppBskyActorDefs.ProfileViewDetailed> {
  const hit = cache.get(actor);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.profile;

  const existing = inflight.get(actor);
  if (existing) return existing;

  const p = (async () => {
    try {
      const res = await agent.getProfile({ actor });
      const profile = res.data;
      // handle と did の両方の key で引けるようにしておく
      // (カラムは handle、通知由来は did で来ることがある)。
      // handle.invalid (凍結等で handle 解決不能) は固有名でないため
      // key にしない (別人の profile が 30s 間混ざるのを防ぐ)。
      const entry: Entry = { profile, ts: Date.now() };
      cache.set(actor, entry);
      cache.set(profile.did, entry);
      if (profile.handle && profile.handle !== 'handle.invalid') {
        cache.set(profile.handle, entry);
      }
      return profile;
    } finally {
      inflight.delete(actor);
    }
  })();
  inflight.set(actor, p);
  return p;
}

/** 指定 actor (handle or DID) のキャッシュを無効化する。
 *  フォロー / フォロー解除のように viewer 状態 (viewer.following 等) を
 *  変えた直後に呼ぶこと (= 30s TTL 内の stale 表示で二重フォロー等の
 *  事故になるのを防ぐ)。 */
export function invalidateProfile(actor: string): void {
  const hit = cache.get(actor);
  cache.delete(actor);
  if (hit) {
    cache.delete(hit.profile.did);
    if (hit.profile.handle) cache.delete(hit.profile.handle);
  }
}

/** テスト用 */
export function clearProfileCache(): void {
  cache.clear();
  inflight.clear();
}
