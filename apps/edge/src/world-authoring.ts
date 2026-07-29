import { decodeWorldMap, loadStaticWorldMap, loadTileArts, setGameQuests, setItemOverrides, setMonsterOverrides, setNpcs, setShopOverrides, setTownOverrides, setWorldMap, WORLD_SIZE, type EquipmentDef, type GameQuestDef, type ItemDefData, type MonsterDef, type NpcDef, type ShopOverride, type TownOverride, type WorldPart } from '@aozoraquest/core';
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
  /** index → パーツ (通行判定の元 + 表示名)。 */
  parts?: WorldPart[];
  /** 街の差分。**地形の画像では表せない**ので別枠 (名前・店の導出元になる)。 */
  towns?: TownOverride[];
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
export function ensureAuthoredWorld(env: WorldAuthoringEnv, nsid: string, now: number): Promise<void> {
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
    const map = await getRecord<WorldMapRecord>(pds, did, `${nsid}.world.map`, RKEY);
    if (map?.value?.gz) {
      const tiles = await decodeWorldMap(fromBase64(map.value.gz));
      setWorldMap({
        tiles,
        size: map.value.size || WORLD_SIZE,
        ...(map.value.palette ? { palette: map.value.palette } : {}),
        ...(map.value.parts ? { parts: map.value.parts } : {}),
      });
      setTownOverrides(map.value.towns ?? null);
    }
    const art = await getRecord<TileArtCollectionRecord>(pds, did, `${nsid}.world.tileArt`, RKEY);
    if (art?.value?.arts) loadTileArts(art.value.arts);
    // **モンスターも edge が読む** (#419)。戦闘計算はここが権威なので、web だけが
    // 編集後の敵を見ていると強さも XP も食い違う。読めなければコード直書きのまま。
    const mon = await getRecord<{ monsters?: MonsterDef[] }>(pds, did, `${nsid}.world.monsters`, RKEY);
    if (mon?.value?.monsters?.length) setMonsterOverrides(mon.value.monsters);
    // どうぐ・装備 (#420)。**店の品揃えと値段は edge が権威** (shopCraft が not_in_stock を弾く)
    // なので、web だけが編集後の装備を見ていると「見えるのに買えない」が起きる。
    const items = await getRecord<{ items?: ItemDefData[]; equipment?: EquipmentDef[] }>(pds, did, `${nsid}.world.items`, RKEY);
    if (items?.value?.equipment?.length) setItemOverrides({ items: items.value.items ?? [], equipment: items.value.equipment });
    // 店のラインナップ (#422)。**アイテムの後に読む** (検証が EQUIPMENT_BY_ID を引くため)。
    const shops = await getRecord<{ shops?: ShopOverride[] }>(pds, did, `${nsid}.world.shops`, RKEY);
    if (shops?.value?.shops?.length) setShopOverrides(shops.value.shops);
    // NPC (#425)。**移動判定に効く** (立っているマスは塞ぐ) ので edge も必須。
    const npcs = await getRecord<{ npcs?: NpcDef[] }>(pds, did, `${nsid}.world.npcs`, RKEY);
    if (npcs?.value?.npcs?.length) setNpcs(npcs.value.npcs);
    // ゲーム内クエスト (#423)。**報酬付与は edge が権威**なので必須。検証が NPC・モンスター・
    // アイテムの実在を引くため、**この 3 つより後に読む** (店 ← アイテムと同じ順序依存)。
    const quests = await getRecord<{ quests?: GameQuestDef[] }>(pds, did, `${nsid}.world.quests`, RKEY);
    // **空配列も適用する** (length で弾かない) — 全クエスト削除の保存が {quests: []} になるので、
    // スキップすると warm isolate に削除済みクエストが残り続け、受注も報酬も通ってしまう。
    if (quests?.value?.quests) setGameQuests(quests.value.quests);
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
