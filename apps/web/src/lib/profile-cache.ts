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
      // (カラムは handle、通知由来は did で来ることがある)
      cache.set(actor, { profile, ts: Date.now() });
      cache.set(profile.did, { profile, ts: Date.now() });
      if (profile.handle) cache.set(profile.handle, { profile, ts: Date.now() });
      return profile;
    } finally {
      inflight.delete(actor);
    }
  })();
  inflight.set(actor, p);
  return p;
}

/** テスト用 */
export function clearProfileCache(): void {
  cache.clear();
  inflight.clear();
}
