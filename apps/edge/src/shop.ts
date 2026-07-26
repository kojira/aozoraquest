/**
 * なんでも屋 (お店) の経済をサーバー権威で処理する (#551 段階 1)。
 *
 * **それまでは全部クライアント権威だった。** 購入も素材のひきとりも しらべる も、
 * client が自分の PDS の台帳を書き換えるだけで、権威 state (`GameState`) の
 * `power` / `materials` は一切動いていなかった。実害は 2 つ:
 *
 * - **素材が複製できる。** `subtractMaterial` はメモリ上のマップを書き換えるだけなので、
 *   購入して素材を減らしてもリロードすれば権威側の在庫がそのまま戻る
 * - **パワーの表示と実体が食い違う。** 「パワーが 5 ふえた!」と出ても権威側は動かず、
 *   報酬の可否 (`rewarded = power >= powerCost`) には効かない
 *
 * ここで扱うのは**費用と在庫** (power / materials)。制作した個体そのもの (強化値つきの
 * `craft` レコード) はまだユーザー PDS にあり、それを権威化するのは #551 段階 2。
 * ただし**強化値の抽選はサーバーが行い**、client はその結果を記帳するだけにしてある。
 */
import {
  CRAFT_TUNING,
  EQUIPMENT_BY_ID,
  SALE_TUNING,
  SEARCH_TUNING,
  craftLevelRoll,
  craftSeedFromRkey,
  isSellableMaterial,
  salePowerFor,
  townAt,
  townShopStock,
  worldOverlay,
} from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv, type OwnedPiece } from './game-state';

/** 冪等キーを覚えておく件数 (`xpClaims` と同じ考え方)。再送・二重送信で二重に課金しない。 */
export const MAX_SHOP_OPS = 100;

export class ShopError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ShopResult {
  power: number;
  materials: Record<string, number>;
  /** 制作したときだけ: 確定した強化値。client はこれを craft レコードに記帳する。 */
  level?: number;
  /** 素材をひきとったときだけ: 得たパワー。 */
  powerGained?: number;
  /** 同じ rkey の再送だったか (client はリトライを止める)。 */
  duplicate?: boolean;
  /** 操作後の所持個体 (#551 段階 2)。client はこれを正として表示する。 */
  pieces?: OwnedPiece[];
}

/**
 * その場所の店。街の上に居ないと買えない。
 *
 * **位置は署名トークンを優先する。** `GameState.x/y` は「街に入ったとき」と
 * テレポート・戦闘決着でしか書かれない (`handleMove` は街のときだけ書く) ので、
 * 街から野外へ数歩あるいても state の座標は街のまま残る = 世界のどこからでも
 * 買えてしまう。トークンが無い/無効なときだけ state に倒す (`handleSearch` と同じ作法)。
 */
function shopAt(state: GameState, pos?: { x: number; y: number }) {
  const town = townAt(pos?.x ?? state.x, pos?.y ?? state.y);
  if (!town) throw new ShopError('街の外では買えない', 400, 'not_in_town');
  const towns = worldOverlay().towns;
  const townIndex = Math.max(0, towns.findIndex((t) => t.x === town.x && t.y === town.y));
  return { town, stock: townShopStock(town, townIndex) };
}

function assertRkey(rkey: string): void {
  if (!rkey || rkey.length > 128) throw new ShopError('rkey が不正', 400);
}

/** 既に処理済みの操作か。処理済みなら現状をそのまま返して二重課金を防ぐ。 */
function alreadyDone(state: GameState, key: string): boolean {
  return (state.shopOps ?? []).includes(key);
}

function withOp(state: GameState, key: string): string[] {
  return [...(state.shopOps ?? []), key].slice(-MAX_SHOP_OPS);
}

/**
 * 装備を作ってもらう。**費用 (パワー + 素材) を権威側から引く**。
 *
 * 品揃えと値段はサーバーが街から導出する (`townShopStock`) — client が送ってきた
 * 値段を信じない。強化値も**サーバーが rkey と luk から抽選**して返す。
 */
export async function shopCraft(
  env: GameStateEnv,
  did: string,
  input: { itemId: string; rkey: string; luk: number; pos?: { x: number; y: number } },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<ShopResult> {
  assertRkey(input.rkey);
  const def = EQUIPMENT_BY_ID[input.itemId];
  if (!def) throw new ShopError('その品は無い', 400, 'unknown_item');
  const opKey = `craft:${input.rkey}`;

  let level = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if (alreadyDone(cur, opKey)) {
        duplicate = true;
        // **強化値は所持個体から引き直す。** 0 を返すと「ナイフ+3」が「ナイフ」として
        // 演出され、リロードで突然 +3 に化ける (名匠 +5 の演出も消える)。
        level = (cur.pieces ?? []).find((p) => p.rkey === input.rkey)?.level ?? 0;
        return cur;
      }
      duplicate = false;
      const { stock } = shopAt(cur, input.pos);
      if (!stock.equipment.includes(def.id)) throw new ShopError('この街では扱っていない', 400, 'not_in_stock');
      if (cur.power < def.price.power) throw new ShopError('あおぞらパワーが たりない', 400, 'no_power');
      const have = cur.materials[stock.materialId] ?? 0;
      if (have < def.price.materials) throw new ShopError('素材が たりない', 400, 'no_material');
      // 強化値は rkey から決定的に引く (同じ rkey の再試行で値が変わらない = 冪等)。
      level = craftLevelRoll(craftSeedFromRkey(input.rkey), input.luk);
      const materials = { ...cur.materials };
      const left = have - def.price.materials;
      if (left > 0) materials[stock.materialId] = left;
      else delete materials[stock.materialId];
      // **個体も権威側で持つ** (#551 段階 2)。ここに無い個体は装備できない。
      const pieces: OwnedPiece[] = [...(cur.pieces ?? []), { rkey: input.rkey, itemId: def.id, level }];
      return { ...cur, power: cur.power - def.price.power, materials, pieces, shopOps: withOp(cur, opKey) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, materials: next.materials, level, duplicate, pieces: next.pieces ?? [] };
}

/** 素材をひきとってもらう (素材 → パワー)。 */
export async function shopSell(
  env: GameStateEnv,
  did: string,
  input: { materialId: string; count: number; rkey: string; pos?: { x: number; y: number } },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<ShopResult> {
  assertRkey(input.rkey);
  if (!isSellableMaterial(input.materialId)) throw new ShopError('ひきとれない品', 400, 'not_sellable');
  const count = Math.floor(input.count);
  if (!Number.isFinite(count) || count <= 0) throw new ShopError('個数が不正', 400);
  const opKey = `sell:${input.rkey}`;

  let powerGained = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if (alreadyDone(cur, opKey)) { duplicate = true; return cur; }
      duplicate = false;
      shopAt(cur, input.pos); // 街の外ではひきとってもらえない
      const have = cur.materials[input.materialId] ?? 0;
      if (have < count) throw new ShopError('素材が たりない', 400, 'no_material');
      // 端数は切り捨て (レートは core が単一の正)。実際に減らすのは換算できたぶんだけ。
      powerGained = salePowerFor(count);
      if (powerGained <= 0) throw new ShopError(`${SALE_TUNING.materialsPerPower} 個から ひきとれる`, 400, 'too_few');
      const spent = powerGained * SALE_TUNING.materialsPerPower;
      const materials = { ...cur.materials };
      const left = have - spent;
      if (left > 0) materials[input.materialId] = left;
      else delete materials[input.materialId];
      return { ...cur, power: cur.power + powerGained, materials, shopOps: withOp(cur, opKey) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, materials: next.materials, powerGained, duplicate, pieces: next.pieces ?? [] };
}

/**
 * きたえる (合成): **同じ品・同じ強化値の 2 個体 → +1 の 1 個体**。素材もパワーも要らない。
 *
 * 消費する個体は `GameState.pieces` から探す — client が「持っている」と言い張る rkey では
 * なく、権威側にある個体だけを対象にする。
 */
export async function shopForge(
  env: GameStateEnv,
  did: string,
  input: { rkeys: [string, string]; rkey: string; pos?: { x: number; y: number } },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<ShopResult> {
  assertRkey(input.rkey);
  const [a, b] = input.rkeys;
  if (!a || !b || a === b) throw new ShopError('個体の指定が不正', 400);
  const opKey = `forge:${input.rkey}`;

  let level = 0;
  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if (alreadyDone(cur, opKey)) {
        duplicate = true;
        level = (cur.pieces ?? []).find((p) => p.rkey === input.rkey)?.level ?? 0;
        return cur;
      }
      duplicate = false;
      shopAt(cur, input.pos); // 街の外では きたえてもらえない
      const owned = cur.pieces ?? [];
      const pa = owned.find((p) => p.rkey === a);
      const pb = owned.find((p) => p.rkey === b);
      if (!pa || !pb) throw new ShopError('その品を もっていない', 400, 'not_owned');
      if (pa.itemId !== pb.itemId || pa.level !== pb.level) throw new ShopError('同じ品・同じ強化値でないと きたえられない', 400, 'mismatch');
      if (pa.level >= CRAFT_TUNING.levelMax) throw new ShopError('これ以上は きたえられない', 400, 'max_level');
      level = pa.level + 1;
      const pieces: OwnedPiece[] = [
        ...owned.filter((p) => p.rkey !== a && p.rkey !== b),
        { rkey: input.rkey, itemId: pa.itemId, level },
      ];
      return { ...cur, pieces, shopOps: withOp(cur, opKey) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, materials: next.materials, level, duplicate, pieces: next.pieces ?? [] };
}

/** しらべるの費用。発見の判定は `handleSearch` 側 (エントロピーが要るため)。 */
export const SEARCH_POWER_COST = SEARCH_TUNING.powerCost;
