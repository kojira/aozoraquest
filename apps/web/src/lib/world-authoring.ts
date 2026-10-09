import { captureNpcPlacementWorld } from './npc-placement';
import type { Agent } from '@atproto/api';
import {
  decodeWorldMap,
  loadAdminWorld,
  BASE_PARTS,
  decodeTileArt,
  bundledWorldMapTiles,
  tileArtTerrains,
  setTileArt,
  dumpTileArts,
  encodeWorldMap,
  loadStaticWorldMap,
  loadTileArts,
  setGameQuests,
  validateGameQuests,
  validateScenario,
  assertStoryFlagTotal,
  currentStory,
  missingStoryBattle,
  setInteriors,
  setScenario,
  setJobOverrides,
  setItemOverrides,
  setMonsterOverrides,
  decodeMonstersFromRecord,
  encodeMonstersForRecord,
  setNpcs,
  validateNpcs,
  setShopOverrides,
  setTownOverrides,
  setWorldMap,
  setWorldParts,
  worldParts,
  worldMapTiles,
  worldTownOverrides,
  WORLD_SIZE,
  type EquipmentDef,
  type Gate,
  type GameQuestDef,
  type InteriorMap,
  type ScenarioEvent,
  type JobOverride,
  type ItemDefData,
  type MonsterDef,
  type NpcDef,
  type ShopOverride,
  type TileArtRecord,
  type TownOverride,
  type WorldPart,
} from '@aozoraquest/core';
import { ADMIN_COL, ADMIN_WORLD_COL } from './collections';
import { getPrimaryAdminDid } from './runtime-config';
import { getRecord, putRecord } from './atproto';

/**
 * **手編集したワールドを管理者 PDS に保存し、全員が読む** (#421)。
 *
 * 保存先を管理者の repo にするのは、`config.flags` 等と同じ理由 —
 * **全環境・全ユーザーが同じ 1 か所を見る**必要があるため。
 *
 * **移動判定は edge が権威**なので、edge も同じレコードを読まないと
 * 「画面では歩けるのにサーバーが弾く」= その場から動けなくなる。
 * edge 側は `apps/edge/src/world-authoring.ts` が同じ rkey を読む。
 */

/** 1 レコード 1 世界なので rkey は固定。 */
const RKEY = 'self';

export interface WorldMapRecord {
  /** 一辺のタイル数 (現状 1024)。 */
  size: number;
  /** 1 タイル 1 バイトのパレット索引を gzip → base64。 */
  gz: string;
  /** index → 地形 id。省略時は既定パレット (後方互換)。 */
  palette?: string[];
  /** index → パーツ (通行判定の元 + 表示名)。「縦の橋」のような増設ぶんもここに入る。 */
  parts?: WorldPart[];
  /** 街の差分 (名前が無ければその座標の街を消す)。**地形の画像では表せない**ので別枠。 */
  towns?: TownOverride[];
  updatedAt: string;
}

export interface TileArtCollectionRecord {
  /** 地形 id → ドット絵。 */
  arts: Record<string, TileArtRecord>;
  updatedAt: string;
}

const toBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  // 一度に渡すと引数が多すぎて落ちるので分割する (27 KB でも 27,000 引数になる)。
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
};

const fromBase64 = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** 編集中の地図を保存する。**管理者本人の repo にしか書けない** (putRecord は自分の repo)。 */
export async function saveWorldMap(agent: Agent, palette?: string[]): Promise<number> {
  const tiles = worldMapTiles();
  if (!tiles) throw new Error('地図が読み込まれていない');
  const gz = await encodeWorldMap(tiles);
  const towns = [...worldTownOverrides()];
  const rec: WorldMapRecord = {
    size: WORLD_SIZE,
    gz: toBase64(gz),
    ...(palette ? { palette } : {}),
    parts: [...worldParts()],
    ...(towns.length ? { towns } : {}),
    updatedAt: new Date().toISOString(),
  };
  await putRecord(agent, ADMIN_COL.worldMap, RKEY, rec);
  return gz.length;
}

/**
 * 描いたドット絵をまとめて保存する。
 *
 * **パーツ一覧 (地図レコード) も一緒に書く。** 絵タブで保存したのに増やしたパーツが
 * 保存されず、次に読み込んだとき一覧から消える、という事故が起きた。
 * 「絵を保存したのにパーツが消える」は追いようがないので、ここで揃えて書く。
 */
export async function saveTileArts(agent: Agent): Promise<number> {
  const arts = dumpTileArts();
  const rec: TileArtCollectionRecord = { arts, updatedAt: new Date().toISOString() };
  await putRecord(agent, ADMIN_COL.tileArt, RKEY, rec);
  if (worldMapTiles()) await saveWorldMap(agent);
  return Object.keys(arts).length;
}

/**
 * 保存済みの世界を読み込む。**無ければ同梱の地図に倒す** (生成そのまま)。
 *
 * 起動時に 1 回。失敗しても握り潰す — 手編集が読めなくても、同梱の地図か
 * ノイズ生成で遊べる状態は保たれる。
 */
export async function loadAuthoredWorld(agent: Agent | null): Promise<void> {
  const adminDid = getPrimaryAdminDid();
  if (agent && adminDid) {
    // 順序と適用規則は core の loadAdminWorld が唯一の定義 (edge と同じ。Refs #718)。
    // 地図が読めなければ同梱の地図に倒れる。BlobRef は保存形の JSON へ戻す (#703)。
    await loadAdminWorld(
      async (name) => adminRecordJson(await getRecord(agent, adminDid, ADMIN_WORLD_COL[name], RKEY)),
      (name, e) => console.warn(`[world] ${name} load failed`, e),
    );
    return;
  }
  await loadStaticWorldMap().catch((e) => console.warn('[world] static map load failed', e));
}

// ─── モンスター (#419) ─────────────────────────────────────

/** 保存レコードの形。monsters の小数の欄は文字列 (#740。encodeMonstersForRecord / decodeMonstersFromRecord)。 */
export interface MonstersRecord {
  monsters: unknown[];
  updatedAt: string;
}

/** 編集したモンスターを保存する。 */
export async function saveMonsters(agent: Agent, monsters: MonsterDef[]): Promise<number> {
  // 保存前に core の検証を通す (壊れた 1 体で全体を落とす)。通れば適用もされる。
  setMonsterOverrides(monsters);
  const rec: MonstersRecord = { monsters: encodeMonstersForRecord(monsters), updatedAt: new Date().toISOString() };
  await putRecord(agent, ADMIN_COL.monsters, RKEY, rec);
  return monsters.length;
}

// ─── どうぐ・装備 (#420) ────────────────────────────────────

export interface ItemsRecordData {
  items: ItemDefData[];
  equipment: EquipmentDef[];
  updatedAt: string;
}

/** 編集したどうぐ・装備を保存する (core の検証を通る = 壊れた 1 件で全体を落とす)。 */
export async function saveItems(agent: Agent, items: ItemDefData[], equipment: EquipmentDef[]): Promise<void> {
  setItemOverrides({ items, equipment });
  const rec: ItemsRecordData = { items, equipment, updatedAt: new Date().toISOString() };
  await putRecord(agent, ADMIN_COL.items, RKEY, rec);
}

// ─── 店のラインナップ (#422) ────────────────────────────────

/** 店ごとの上書きを保存する (core の検証を通る = 未知 id は保存で弾かれる)。 */
export async function saveShops(agent: Agent, shops: ShopOverride[]): Promise<void> {
  setShopOverrides(shops);
  await putRecord(agent, ADMIN_COL.shops, RKEY, { shops, updatedAt: new Date().toISOString() });
}

// ─── NPC (#425) ─────────────────────────────────────────────

/** NPC を保存する (core の検証を通る = 壊れた 1 人で全体が落ちる)。 */
export async function saveNpcs(agent: Agent, npcs: NpcDef[], isCurrent = () => true): Promise<void> {
  validateNpcs(npcs);
  const missing = missingStoryBattle(npcs, []);
  if (missing) throw new Error(missing);
  if (!isCurrent()) throw new Error('保存を取り消しました');
  await putRecord(agent, ADMIN_COL.npcs, RKEY, { npcs, updatedAt: new Date().toISOString() });
  if (isCurrent()) setNpcs(npcs);
}

/**
 * ジョブのレコードだけを読む (#544)。**読めたかどうかを返す**のが要点 —
 * loadAuthoredWorld は失敗を握り潰すので、エディタがそれを使うと
 * 「読み込み失敗 → コード値が並ぶ → 保存 → 保存済みの調整が全職ぶん消える」が起きる。
 * `null` = レコードが無い (初回)。throw = 読めなかった (保存させてはいけない)。
 */
export async function loadJobsRecord(agent: Agent, adminDid: string): Promise<JobOverride[] | null> {
  const rec = await getRecord<{ jobs?: JobOverride[] }>(agent, adminDid, ADMIN_COL.jobs, RKEY);
  if (!rec?.jobs) return null;
  setJobOverrides(rec.jobs);
  return rec.jobs;
}

/**
 * 内部マップとゲート (#424)。タイルは gzip+base64 (フィールドの地図と同じ形式)。
 * setInteriors が先に検証で落とす (行き先が無いゲートを保存させない)。
 */
export async function saveInteriors(agent: Agent, maps: InteriorMap[], gates: Gate[]): Promise<void> {
  setInteriors(maps, gates);
  const interiors = [];
  for (const m of maps) {
    const { tiles, ...rest } = m;
    interiors.push({ ...rest, gz: toBase64(await encodeWorldMap(tiles)) });
  }
  await putRecord(agent, ADMIN_COL.interiors, RKEY, { interiors, gates, updatedAt: new Date().toISOString() });
}

/** 内部マップだけを読む (エディタ用。読めたかどうかを返す = 上書き事故を防ぐ)。 */
export async function loadInteriorsRecord(agent: Agent, adminDid: string): Promise<{ maps: InteriorMap[]; gates: Gate[] }> {
  const rec = await getRecord<{ interiors?: Array<Omit<InteriorMap, 'tiles'> & { gz: string }>; gates?: Gate[] }>(agent, adminDid, ADMIN_COL.interiors, RKEY);
  const maps: InteriorMap[] = [];
  for (const m of rec?.interiors ?? []) {
    const { gz, ...rest } = m;
    maps.push({ ...rest, tiles: await decodeWorldMap(fromBase64(gz)) });
  }
  const gates = rec?.gates ?? [];
  setInteriors(maps, gates);
  return { maps, gates };
}

/** シナリオ (#545)。setScenario が先に検証で落とす (存在しないクエストを条件にさせない)。 */
export async function saveScenario(agent: Agent, events: ScenarioEvent[]): Promise<void> {
  validateScenario(events);
  assertStoryFlagTotal(events, currentStory());
  await putRecord(agent, ADMIN_COL.scenario, RKEY, { events, updatedAt: new Date().toISOString() });
  setScenario(events);
}

/** シナリオだけを読む (エディタ用。読めたかどうかを返す = 上書き事故を防ぐ)。 */
export async function loadScenarioRecord(agent: Agent, adminDid: string): Promise<ScenarioEvent[]> {
  const rec = await getAuthoringRecord<{ events?: ScenarioEvent[] }>(agent, adminDid, ADMIN_COL.scenario, RKEY);
  if (rec && !Array.isArray(rec.events)) throw new Error('シナリオ レコードが不正');
  const events = rec?.events ?? [];
  setScenario(events);
  return events;
}

/** ジョブのパラメータ (#544)。setJobOverrides が先に検証で落とす。 */
export async function saveJobs(agent: Agent, jobs: JobOverride[]): Promise<void> {
  setJobOverrides(jobs);
  await putRecord(agent, ADMIN_COL.jobs, RKEY, { jobs, updatedAt: new Date().toISOString() });
}

/** ゲーム内クエスト (#423)。setGameQuests が先に検証で落とす (壊れた定義を保存させない)。 */
export async function saveGameQuests(agent: Agent, quests: GameQuestDef[]): Promise<void> {
  validateGameQuests(quests);
  const missing = missingStoryBattle([], quests);
  if (missing) throw new Error(missing);
  await putRecord(agent, ADMIN_COL.quests, RKEY, { quests, updatedAt: new Date().toISOString() });
  setGameQuests(quests);
}

/** 導入データの編集用。読込み失敗を空リストとして保存させない。 */
export async function loadQuestAuthoringRecords(agent: Agent, adminDid: string): Promise<GameQuestDef[]> {
  // Referenced records must be persisted, not another editor's unsaved in-memory draft.
  const npcs = await getAuthoringRecord<{ npcs: NpcDef[] }>(agent, adminDid, ADMIN_COL.npcs, RKEY);
  if (npcs && !Array.isArray(npcs.npcs)) throw new Error('NPC レコードが不正');
  setNpcs(npcs?.npcs ?? []);
  const interiors = await getAuthoringRecord<{ interiors: Array<Omit<InteriorMap, 'tiles'> & { gz: string }>; gates: Gate[] }>(agent, adminDid, ADMIN_COL.interiors, RKEY);
  if (interiors && (!Array.isArray(interiors.interiors) || !Array.isArray(interiors.gates))) throw new Error('内部マップ レコードが不正');
  const maps: InteriorMap[] = [];
  for (const m of interiors?.interiors ?? []) {
    const { gz, ...rest } = m;
    maps.push({ ...rest, tiles: await decodeWorldMap(fromBase64(gz)) });
  }
  setInteriors(maps, interiors?.gates ?? []);
  const rec = await getAuthoringRecord<{ quests: GameQuestDef[] }>(agent, adminDid, ADMIN_COL.quests, RKEY);
  if (rec && !Array.isArray(rec.quests)) throw new Error('クエスト レコードが不正');
  const quests = rec?.quests ?? [];
  setGameQuests(quests);
  return quests;
}

/**
 * Agent の getRecord は blob を `BlobRef` (ref は CID オブジェクト) に復元して返す。NPC 画像の
 * 検証 (`assertNpcImage`) と edge は保存形の JSON (`{$type:'blob', ref:{$link}}`) を前提にするので、
 * 読んだ管理レコードは JSON 表現へ戻してから使う (戻さないと NPC レコード全体が不正扱いで落ちる。#703)。
 * `lexToJson` は依存に @atproto/lexicon が 2 版入っていて instanceof が外れ、実応答を戻せなかった。
 * `BlobRef.toJSON()` は版によらず保存形を返すので JSON 往復で戻す。
 */
function adminRecordJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

/** 通信/認証失敗を「まだレコードが無い」と取り違えない編集用読込み。 */
async function getAuthoringRecord<T>(agent: Agent, repo: string, collection: string, rkey: string): Promise<T | null> {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    return adminRecordJson(res.data.value as T);
  } catch (e) {
    const error = e as { error?: string; name?: string };
    if (error.error === 'RecordNotFound' || error.name === 'RecordNotFoundError') return null;
    throw e;
  }
}

/** Strict NPC editor load. No communication/decode failure may masquerade as an empty map. */
export async function loadNpcAuthoringRecords(agent: Agent, adminDid: string, isCurrent = () => true) {
  const read = <T,>(collection: string) => getAuthoringRecord<T>(agent, adminDid, collection, RKEY);
  const [map, art, items, monsters, npcs, interior, quests] = await Promise.all([
    read<WorldMapRecord>(ADMIN_COL.worldMap), read<TileArtCollectionRecord>(ADMIN_COL.tileArt),
    read<ItemsRecordData>(ADMIN_COL.items), read<MonstersRecord>(ADMIN_COL.monsters),
    read<{ npcs: NpcDef[] }>(ADMIN_COL.npcs),
    read<{ interiors: Array<Omit<InteriorMap, 'tiles'> & { gz: string }>; gates: Gate[] }>(ADMIN_COL.interiors),
    read<{ quests: GameQuestDef[] }>(ADMIN_COL.quests),
  ]);
  if (map && (typeof map.gz !== 'string' || map.size !== WORLD_SIZE)) throw new Error('地図レコードが不正');
  if (art && (!art.arts || typeof art.arts !== 'object' || Array.isArray(art.arts))) throw new Error('絵レコードが不正');
  if (items && (!Array.isArray(items.items) || !Array.isArray(items.equipment))) throw new Error('アイテムレコードが不正');
  if (monsters && !Array.isArray(monsters.monsters)) throw new Error('モンスターレコードが不正');
  if (npcs && !Array.isArray(npcs.npcs)) throw new Error('NPCレコードが不正');
  if (quests && !Array.isArray(quests.quests)) throw new Error('クエストレコードが不正');
  if (interior && (!Array.isArray(interior.interiors) || !Array.isArray(interior.gates))) throw new Error('内部マップレコードが不正');
  const tiles = map ? await decodeWorldMap(fromBase64(map.gz)) : await bundledWorldMapTiles();
  const maps: InteriorMap[] = [];
  for (const m of interior?.interiors ?? []) {
    const { gz, ...rest } = m;
    maps.push({ ...rest, tiles: await decodeWorldMap(fromBase64(gz)) });
  }
  const arts = Object.entries(art?.arts ?? {}).map(([key, value]) => [key, decodeTileArt(value)] as const);
  // There are no awaits after this guard. Superseded sessions cannot publish stale responses.
  if (!isCurrent()) throw new Error('読み込みを取り消しました');
  const parts = map?.parts ?? map?.palette?.map((terrain) => ({ terrain, name: terrain })) ?? BASE_PARTS;
  if (!Array.isArray(parts)) throw new Error('地図パーツが不正');
  setWorldParts(parts);
  setWorldMap({ tiles, size: WORLD_SIZE, parts });
  setTownOverrides(map?.towns ?? null);
  setItemOverrides(items ?? null);
  setMonsterOverrides(monsters ? decodeMonstersFromRecord(monsters.monsters) : null);
  setNpcs(npcs?.npcs ?? []);
  setInteriors(maps, interior?.gates ?? []);
  setGameQuests(quests?.quests ?? []);
  for (const key of tileArtTerrains()) setTileArt(key, null);
  for (const [key, value] of arts) setTileArt(key, value);
  const list = structuredClone(npcs?.npcs ?? []);
  return { list, world: captureNpcPlacementWorld(list, !map) };
}
