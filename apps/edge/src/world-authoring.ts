import { decodeWorldMap, loadStaticWorldMap, loadTileArts, setWorldMap, WORLD_SIZE } from '@aozoraquest/core';
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
}

interface WorldMapRecord {
  size?: number;
  gz?: string;
  palette?: string[];
}
interface TileArtCollectionRecord {
  arts?: Record<string, { size: number; palette: string[]; pixels: string }>;
}

let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** 主管理者 DID (先頭)。未設定なら null。 */
function primaryAdminDid(env: WorldAuthoringEnv): string | null {
  const first = (env.ADMIN_DIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  return first ?? null;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 世界を読み込む (キャッシュ付き)。**await しないで呼んでよい** — 読み込むまでは
 * 同梱の地図かノイズ生成に倒れるだけで、結果は「編集前の世界」として一貫している。
 */
export function ensureAuthoredWorld(env: WorldAuthoringEnv, nsid: string, now: number): void {
  if (inflight) return;
  if (loadedAt && now - loadedAt < CACHE_TTL_SEC) return;
  inflight = (async () => {
    // **まず同梱の地図を入れる。** 手編集が無い / 読めない場合でも、terrainAt が
    // 配列参照になって速いままでいられる。
    await loadStaticWorldMap().catch(() => {});
    const did = primaryAdminDid(env);
    if (!did) return;
    const doc = await resolveDidDocument(did);
    const pds = pdsEndpointFromDoc(doc as Parameters<typeof pdsEndpointFromDoc>[0], did);
    if (!pds) return;
    const map = await getRecord<WorldMapRecord>(pds, did, `${nsid}.world.map`, RKEY);
    if (map?.value?.gz) {
      const tiles = await decodeWorldMap(fromBase64(map.value.gz));
      setWorldMap({
        tiles,
        size: map.value.size || WORLD_SIZE,
        ...(map.value.palette ? { palette: map.value.palette } : {}),
      });
    }
    const art = await getRecord<TileArtCollectionRecord>(pds, did, `${nsid}.world.tileArt`, RKEY);
    if (art?.value?.arts) loadTileArts(art.value.arts);
  })()
    .catch((e) => {
      // **落ちてもゲームは続く** (同梱の地図 or ノイズ生成に倒れる)。次の TTL で再試行。
      console.warn('authored world load failed', e);
    })
    .finally(() => {
      loadedAt = now;
      inflight = null;
    });
}

/** テスト用: キャッシュを捨てる。 */
export function resetAuthoredWorldCache(): void {
  loadedAt = 0;
  inflight = null;
}
