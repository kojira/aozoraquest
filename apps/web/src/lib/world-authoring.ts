import type { Agent } from '@atproto/api';
import {
  decodeWorldMap,
  dumpTileArts,
  encodeWorldMap,
  loadStaticWorldMap,
  loadTileArts,
  setTownOverrides,
  setWorldMap,
  setWorldParts,
  worldParts,
  worldMapTiles,
  worldTownOverrides,
  WORLD_SIZE,
  type TileArtRecord,
  type TownOverride,
  type WorldPart,
} from '@aozoraquest/core';
import { ADMIN_COL } from './collections';
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
    try {
      const rec = await getRecord<WorldMapRecord>(agent, adminDid, ADMIN_COL.worldMap, RKEY);
      if (rec?.gz) {
        const tiles = await decodeWorldMap(fromBase64(rec.gz));
        setWorldMap({
          tiles,
          size: rec.size || WORLD_SIZE,
          ...(rec.palette ? { palette: rec.palette } : {}),
          ...(rec.parts ? { parts: rec.parts } : {}),
        });
        setTownOverrides(rec.towns ?? null);
      } else {
        await loadStaticWorldMap();
      }
    } catch (e) {
      console.warn('[world] authored map load failed', e);
      await loadStaticWorldMap().catch(() => {});
    }
    try {
      const rec = await getRecord<TileArtCollectionRecord>(agent, adminDid, ADMIN_COL.tileArt, RKEY);
      if (rec?.arts) loadTileArts(rec.arts);
    } catch (e) {
      console.warn('[world] tile art load failed', e);
    }
    return;
  }
  await loadStaticWorldMap().catch((e) => console.warn('[world] static map load failed', e));
}
