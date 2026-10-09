/**
 * 管理者 PDS の world.* レコードを読んで core に適用する唯一の手順 (Refs #718)。
 * web (`loadAuthoredWorld`) と edge (`ensureAuthoredWorld`) はレコードの取り方だけを渡す。
 *
 * 順序 (ADMIN_WORLD_RECORDS): map → tileArt → monsters → monsterArt → items → shops → npcs → jobs → interiors → quests → scenario → story。
 *   - shops は items の後 (検証が EQUIPMENT_BY_ID / ITEMS を引く)。
 *   - quests は npcs・monsters・items の後 (検証が実在を引く)。scenario は quests の後 (questId を引く)。
 *   - story は scenario の後 (フラグ数を scenario.setFlags と合わせて数える。D-STORY-009)。
 *   - jobs と interiors は互いに独立: setJobOverrides は JOBS_BY_ID と装備カテゴリだけ、
 *     setInteriors は ITEMS と townAt だけを引く。旧 web は interiors→jobs、edge は jobs→interiors
 *     だったが結果は同じなので edge の順に揃えた。
 *
 * 適用規則 (#660): レコードが**無ければ触らない**。あれば適用する。
 *   - shops / npcs / jobs / quests / scenario / story / interiors は**空配列でも適用** (全削除の反映)。
 *   - items (equipment) は**空なら適用しない** (コード直書きのまま)。
 *   - monsters は**空なら「無い」と同じ** (MonsterDataError。コードには敵が無いので cache へ倒す)。
 *   - monsterArt は**空・壊れていれば** MonsterArtError (cache へ倒す。コードには「?」の絵しか無い)。
 *   web と edge でこの規則に差は無かった。
 * 1 レコードの失敗は後続を止めない (onError に渡して次へ)。
 *
 * cache (D-MONSTER-001。`names` は monsters と monsterArt だけ): PDS の値を適用できたら `write`。
 * PDS が throw / 無い / 空 / 検証 NG のときは `read` の値を適用する。壊れた値・空の値は write しない。
 */
import { ADMIN_WORLD_RECORDS, type AdminWorldRecordName } from './admin-nsid.js';
import { decodeWorldMap, loadStaticWorldMap, setTownOverrides, setWorldMap, type TownOverride, type WorldPart } from './world-map.js';
import { WORLD_SIZE } from './world.js';
import { loadTileArts, type TileArtRecord } from './tile-art.js';
import { MonsterDataError, setMonsterOverrides } from './monster-data.js';
import { decodeMonstersFromRecord } from './monster-record.js';
import { setMonsterArts, type MonsterArtDef } from './monster-art.js';
import { setItemOverrides, type ItemDefData } from './item-data.js';
import type { EquipmentDef } from './equipment.js';
import { setShopOverrides, type ShopOverride } from './shop-data.js';
import { setNpcs, type NpcDef } from './npc-data.js';
import { setJobOverrides, type JobOverride } from './job-data.js';
import { setInteriors, type Gate, type InteriorMap } from './interior.js';
import { setGameQuests, type GameQuestDef } from './quest-data.js';
import { setScenario, type ScenarioEvent } from './scenario.js';
import { setStory, type StoryData } from './story-data.js';

/** レコードの value を返す。**無ければ null**。通信失敗などは throw (そのレコードだけ飛ばす)。 */
export type AdminWorldRecordFetch = (name: AdminWorldRecordName) => Promise<unknown>;

/** last-good の保存先 (edge = KV、web = edge の GET)。`read` は無ければ null。 */
export interface AdminWorldRecordCache {
  names: readonly AdminWorldRecordName[];
  read(name: AdminWorldRecordName): Promise<unknown>;
  write(name: AdminWorldRecordName, value: unknown): Promise<void>;
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Rec<T> = Partial<T> | null | undefined;

const APPLY: Record<AdminWorldRecordName, (value: unknown) => Promise<void> | void> = {
  map: async (v) => {
    const rec = v as Rec<{ size: number; gz: string; palette: string[]; parts: WorldPart[]; towns: TownOverride[] }>;
    // 手編集が無ければ同梱の地図 (生成そのまま)。
    if (!rec?.gz) return loadStaticWorldMap();
    const tiles = await decodeWorldMap(fromBase64(rec.gz));
    setWorldMap({ tiles, size: rec.size || WORLD_SIZE, ...(rec.palette ? { palette: rec.palette } : {}), ...(rec.parts ? { parts: rec.parts } : {}) });
    setTownOverrides(rec.towns ?? null);
  },
  tileArt: (v) => { const rec = v as Rec<{ arts: Record<string, TileArtRecord> }>; if (rec?.arts) loadTileArts(rec.arts); },
  monsters: (v) => {
    if (v == null) return; // 無ければ触らない (cache 経路では無いときに KV へ倒す)
    const monsters = decodeMonstersFromRecord((v as Rec<{ monsters: unknown }>)?.monsters); // 小数は文字列で保存 (#740)
    if (!monsters.length) throw new MonsterDataError('monsters レコードが空');
    setMonsterOverrides(monsters);
  },
  monsterArt: (v) => {
    if (v == null) return;
    setMonsterArts((v as Rec<{ arts: MonsterArtDef[] }>)?.arts ?? []);
  },
  items: (v) => {
    const rec = v as Rec<{ items: ItemDefData[]; equipment: EquipmentDef[] }>;
    if (rec?.equipment?.length) setItemOverrides({ items: rec.items ?? [], equipment: rec.equipment });
  },
  shops: (v) => { const rec = v as Rec<{ shops: ShopOverride[] }>; if (rec?.shops) setShopOverrides(rec.shops); },
  npcs: (v) => { const rec = v as Rec<{ npcs: NpcDef[] }>; if (rec?.npcs) setNpcs(rec.npcs); },
  jobs: (v) => { const rec = v as Rec<{ jobs: JobOverride[] }>; if (rec?.jobs) setJobOverrides(rec.jobs); },
  interiors: async (v) => {
    const rec = v as Rec<{ interiors: Array<Omit<InteriorMap, 'tiles'> & { gz: string }>; gates: Gate[] }>;
    if (!rec) return;
    const maps: InteriorMap[] = [];
    for (const { gz, ...rest } of rec.interiors ?? []) maps.push({ ...rest, tiles: await decodeWorldMap(fromBase64(gz)) });
    setInteriors(maps, rec.gates ?? []);
  },
  quests: (v) => { const rec = v as Rec<{ quests: GameQuestDef[] }>; if (rec?.quests) setGameQuests(rec.quests); },
  scenario: (v) => { const rec = v as Rec<{ events: ScenarioEvent[] }>; if (rec?.events) setScenario(rec.events); },
  story: (v) => { const rec = v as Rec<StoryData>; if (rec) setStory(rec); },
};

/** 全 world.* レコードを決まった順に読んで適用する。地図が読めなければ同梱の地図に倒す。 */
export async function loadAdminWorld(
  fetchRecord: AdminWorldRecordFetch,
  onError: (name: AdminWorldRecordName, e: unknown) => void,
  cache?: AdminWorldRecordCache,
): Promise<void> {
  for (const name of ADMIN_WORLD_RECORDS) {
    if (cache?.names.includes(name)) {
      await loadCachedRecord(name, fetchRecord, onError, cache);
      continue;
    }
    try {
      await APPLY[name](await fetchRecord(name));
    } catch (e) {
      onError(name, e);
      if (name === 'map') await loadStaticWorldMap().catch(() => {});
    }
  }
}

async function loadCachedRecord(
  name: AdminWorldRecordName,
  fetchRecord: AdminWorldRecordFetch,
  onError: (name: AdminWorldRecordName, e: unknown) => void,
  cache: AdminWorldRecordCache,
): Promise<void> {
  try {
    const value = await fetchRecord(name);
    if (value != null) {
      await APPLY[name](value);
      await cache.write(name, value).catch((e) => onError(name, e));
      return;
    }
  } catch (e) {
    onError(name, e);
  }
  try {
    const cached = await cache.read(name);
    if (cached != null) await APPLY[name](cached);
  } catch (e) {
    onError(name, e);
  }
}
