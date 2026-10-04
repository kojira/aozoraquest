import { adminNsidPrefix, adminWorldCollection, AQ_NSID_ROOT, loadAdminWorld, loadStaticWorldMap } from '@aozoraquest/core';
import { getRecord } from './pds';
import { resolveDidDocument } from './service-auth';
import { pdsEndpointFromDoc } from './oauth-metadata';

/**
 * **手編集したワールドを edge も読む** (#421)。
 *
 * 移動判定はここ (edge) が権威 (`battle-resolver` の `terrainAt`)。web だけが手編集した
 * 地図を見ていると「画面では歩けるのにサーバーが弾く」= **プレイヤーがその場から
 * 動けなくなる**。同じ管理者 repo の同じ rkey を読んで揃える。
 *
 * **リクエストごとに読まない。** isolate ごとにキャッシュし、TTL で寝かせる。
 * PDS の読み取りは書き込み点数を消費しないが、毎リクエストの往復はレイテンシに乗る。
 */

const RKEY = 'self';
const CACHE_TTL_SEC = 300;

export interface WorldAuthoringEnv {
  /** カンマ区切り。先頭を主管理者として扱う (web の getPrimaryAdminDid と同じ規則)。 */
  ADMIN_DIDS?: string;
  /** 管理データの env suffix (#716)。dev エッジは "dev" ([env.dev.vars])、本番は未設定。 */
  ADMIN_NSID_ENV?: string;
}

/** 管理レコードの NSID の根 (#716)。dev エッジ = `app.aozoraquest.dev`、本番 = `app.aozoraquest`。
 *  web の ADMIN_COL と同じ規則。dev にレコードが無ければ同梱の既定に倒れる (本番は読まない)。 */
export function adminNsidRoot(env: WorldAuthoringEnv): string {
  return adminNsidPrefix(AQ_NSID_ROOT, env.ADMIN_NSID_ENV);
}

let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** 主管理者 DID (先頭)。未設定なら null。 */
function primaryAdminDid(env: WorldAuthoringEnv): string | null {
  const first = (env.ADMIN_DIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

/**
 * 世界を読み込む (キャッシュ付き)。**返り値を必ず `ctx.waitUntil` に載せること。**
 *
 * 投げっぱなしにすると、リクエストが同期的に return した瞬間 (CORS preflight の
 * OPTIONS が該当) に I/O コンテキストごと捨てられ、promise が **reject もせず
 * settle しない**。`.catch()` も走らないので警告すら出ず、`inflight` がラッチされた
 * ままで**その isolate は二度と読み込まない** (workerd で実測)。
 *
 * リクエスト自体は待たせない — 読み込むまでは同梱の地図かノイズ生成に倒れるだけで、
 * 結果は「編集前の世界」として一貫している。
 */
export function ensureAuthoredWorld(env: WorldAuthoringEnv, now: number): Promise<void> {
  const nsid = adminNsidRoot(env);
  if (inflight) return inflight;
  if (loadedAt && now - loadedAt < CACHE_TTL_SEC) return Promise.resolve();
  inflight = (async () => {
    // **まず同梱の地図を入れる。** 手編集が無い / 読めない場合でも、terrainAt が
    // 配列参照になって速いままでいられる。
    await loadStaticWorldMap().catch(() => {});
    const did = primaryAdminDid(env);
    if (!did) return;
    const doc = await resolveDidDocument(did);
    const pds = pdsEndpointFromDoc(doc as Parameters<typeof pdsEndpointFromDoc>[0], did);
    if (!pds) return;
    // 順序と適用規則は core の loadAdminWorld が唯一の定義 (Refs #718)。1 つが壊れても後続を止めない。
    await loadAdminWorld(
      async (name) => (await getRecord(pds, did, adminWorldCollection(nsid, name), RKEY))?.value ?? null,
      (name, e) => console.warn(`authored world: ${name} failed`, e),
    );
  })()
    .catch((e) => {
      // **落ちてもゲームは続く** (同梱の地図 or ノイズ生成に倒れる)。次の TTL で再試行。
      console.warn('authored world load failed', e);
    })
    .finally(() => {
      loadedAt = now;
      inflight = null;
    });
  return inflight;
}

/** テスト用: キャッシュを捨てる。 */
export function resetAuthoredWorldCache(): void {
  loadedAt = 0;
  inflight = null;
}
