/**
 * 管理者 PDS の world.* レコードを読んで core に適用する唯一の手順 (Refs #718)。
 * web (`loadAuthoredWorld`) と edge (`ensureAuthoredWorld`) はレコードの取り方だけを渡す。
 *
 * 順序 (ADMIN_WORLD_RECORDS): map → tileArt → monsters → items → shops → npcs → jobs → interiors → quests → scenario。
 *   - shops は items の後 (検証が EQUIPMENT_BY_ID / ITEMS を引く)。
 *   - quests は npcs・monsters・items の後 (検証が実在を引く)。scenario は quests の後 (questId を引く)。
 *   - jobs と interiors は互いに独立: setJobOverrides は JOBS_BY_ID と装備カテゴリだけ、
 *     setInteriors は ITEMS と townAt だけを引く。旧 web は interiors→jobs、edge は jobs→interiors
 *     だったが結果は同じなので edge の順に揃えた。
 *
 * 適用規則 (#660): レコードが**無ければ触らない**。あれば適用する。
 *   - shops / npcs / jobs / quests / scenario / interiors は**空配列でも適用** (全削除の反映)。
 *   - monsters と items (equipment) は**空なら適用しない** (コード直書きのまま。戦闘を止めない)。
 *   web と edge でこの規則に差は無かった。
 * 1 レコードの失敗は後続を止めない (onError に渡して次へ)。
 */
import { ADMIN_WORLD_RECORDS, type AdminWorldRecordName } from './admin-nsid.js';
import { decodeWorldMap, loadStaticWorldMap, setTownOverrides, setWorldMap, type TownOverride, type WorldPart } from './world-map.js';
import { WORLD_SIZE } from './world.js';
import { loadTileArts, type TileArtRecord } from './tile-art.js';
import { setMonsterOverrides } from './monster-data.js';
import type { MonsterDef } from './battle.js';
import { setItemOverrides, type ItemDefData } from './item-data.js';
import type { EquipmentDef } from './equipment.js';
import { setShopOverrides, type ShopOverride } from './shop-data.js';
import { setNpcs, type NpcDef } from './npc-data.js';
import { setJobOverrides, type JobOverride } from './job-data.js';
import { setInteriors, type Gate, type InteriorMap } from './interior.js';
import { setGameQuests, type GameQuestDef } from './quest-data.js';
import { setScenario, type ScenarioEvent } from './scenario.js';

/** レコードの value を返す。**無ければ null**。通信失敗などは throw (そのレコードだけ飛ばす)。 */
export type AdminWorldRecordFetch = (name: AdminWorldRecordName) => Promise<unknown>;

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
  monsters: (v) => { const rec = v as Rec<{ monsters: MonsterDef[] }>; if (rec?.monsters?.length) setMonsterOverrides(rec.monsters); },
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
};

/** 全 world.* レコードを決まった順に読んで適用する。地図が読めなければ同梱の地図に倒す。 */
export async function loadAdminWorld(fetchRecord: AdminWorldRecordFetch, onError: (name: AdminWorldRecordName, e: unknown) => void): Promise<void> {
  for (const name of ADMIN_WORLD_RECORDS) {
    try {
      await APPLY[name](await fetchRecord(name));
    } catch (e) {
      onError(name, e);
      if (name === 'map') await loadStaticWorldMap().catch(() => {});
    }
  }
}
