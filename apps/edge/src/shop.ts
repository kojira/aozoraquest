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
import { interiorShopAt, GEAR_SLOTS,
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
import { readModifyWrite, type GameState, type GameStateEnv, type OwnedPiece, sanitizeGear } from './game-state';

/** 冪等キーを覚えておく件数 (`xpClaims` と同じ考え方)。再送・二重送信で二重に課金しない。 */
export const MAX_SHOP_OPS = 100;

/**
 * **所持できる装備個体の上限** (#575)。
 *
 * `GameState.pieces` は制作のたびに 1 個ずつ増え、減るのは合成 (2 個 → 1 個) だけだった。
 * 上限が無いと権威レコードが PDS のサイズ上限に当たり、**そのユーザーの書き込みが
 * 全部 fail-closed になってプレイ不能**になる (同じ経路の警告が xp-claim.ts にある)。
 *
 * `xpClaims` (200) や `shopOps` (100) と違って**リングにはできない** — 古いものを黙って
 * 消したら装備が消えるため。上限に達したら断り、`shopDiscard` で自分で減らしてもらう。
 *
 * 100 の根拠: 装備スロットは 6 (weapon/armor/charm)。16 職ぶん持ち替えても 48 で、
 * 合成用の予備を足しても 100 で窮屈にならない。1 個体 ~60 バイトなので 100 個で ~6 KB。
 */
export const MAX_OWNED_PIECES = 100;

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
function shopAt(state: GameState, pos?: { x: number; y: number; mapId?: string }) {
  const x = pos?.x ?? state.x;
  const y = pos?.y ?? state.y;
  const mapId = pos?.mapId ?? state.mapId;
  // **村の中のなんでも屋** (#424)。内部マップの座標はフィールドの街と無関係なので、
  // 店のマスに立っているときだけ、その店が指す街の品揃えで開く。
  const inner = mapId ? interiorShopAt(mapId, x, y) : undefined;
  const town = inner ? townAt(inner.town.x, inner.town.y) : townAt(x, y);
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
  input: { itemId: string; rkey: string; luk: number; pos?: { x: number; y: number; mapId?: string } },
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
      assertRoomForPiece(cur);
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
  input: { materialId: string; count: number; rkey: string; pos?: { x: number; y: number; mapId?: string } },
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
  input: { rkeys: [string, string]; rkey: string; pos?: { x: number; y: number; mapId?: string } },
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

/**
 * 所持上限に空きがあるか。**上限に達したら黙って古いものを消さず、断る。**
 * 消すと「知らないうちに装備が無くなっていた」になり、原因も追えない。
 */
function assertRoomForPiece(state: GameState): void {
  if ((state.pieces ?? []).length >= MAX_OWNED_PIECES) {
    throw new ShopError(`もちものが いっぱいだ (${MAX_OWNED_PIECES} 個)。すてるか きたえて へらしてほしい`, 400, 'pieces_full');
  }
}

/**
 * 装備を**すてる** (#575)。
 *
 * 合成は「同じ品・同じ強化値が 2 個」要るので、1 個しかない不要品は今まで
 * **永久に持ち続けるしかなかった**。所持上限を入れるとそれが手詰まりになるため対で入れる。
 *
 * **パワーは返さない。** 返すと「作る → すてる」でパワーが増える経路になる
 * (制作費より返す額を小さくしても、素材のひきとりと合わせて抜け道を探す余地が残る)。
 */
export async function shopDiscard(
  env: GameStateEnv,
  did: string,
  input: { rkeys: string[]; rkey: string },
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<ShopResult> {
  assertRkey(input.rkey);
  if (!input.rkeys?.length) throw new ShopError('個体の指定が不正', 400);
  // まとめて捨てられるようにする (1 個ずつだと 100 個の整理で 100 往復になる)。
  const targets = new Set(input.rkeys);
  if (targets.size !== input.rkeys.length) throw new ShopError('個体の指定が重複している', 400);
  const opKey = `discard:${input.rkey}`;

  let duplicate = false;
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if (alreadyDone(cur, opKey)) {
        duplicate = true;
        return cur;
      }
      duplicate = false;
      const owned = cur.pieces ?? [];
      // **持っていない個体を混ぜてきたら全部断る。** 部分適用すると client 側の
      // 表示と権威がずれ、何が消えたのか誰にも分からなくなる。
      for (const r of targets) {
        if (!owned.some((p) => p.rkey === r)) throw new ShopError('その品を もっていない', 400, 'not_owned');
      }
      const rest = owned.filter((p) => !targets.has(p.rkey));
      // **そうび中の個体は捨てられない。** UI では止めているが API を直に叩けば通ってしまい、
      // gearSel が持ち主のいない個体を指したまま残る = **持っていない装備の補正が戦闘に乗り続ける**
      // (sanitizeGear は handleGear からしか呼ばれず、戦闘は生の gearSel を使う)。
      // 「はずしてから捨てて」と言うほうが、黙って外すより何が起きたか分かる。
      const stillEquipped = sanitizeGear(cur.gearSel ?? {}, owned);
      const afterEquipped = sanitizeGear(cur.gearSel ?? {}, rest);
      // 全スロットを見る (#609)。3 スロット直書きのままだと盾/頭/足だけ
      // 「そうび中でも捨てられる」という非対称ができる (レビュー ★★)。
      for (const slot of GEAR_SLOTS) {
        if (stillEquipped[slot] && !afterEquipped[slot]) {
          throw new ShopError('そうび中の品は すてられない。さきに はずしてほしい', 400, 'equipped');
        }
      }
      // 掃除も掛ける (古いデータで gearSel が既に宙に浮いている場合の後始末)。
      return { ...cur, pieces: rest, gearSel: afterEquipped, shopOps: withOp(cur, opKey) };
    },
    init ? { now, init } : { now },
  );
  return { power: next.power, materials: next.materials, duplicate, pieces: next.pieces ?? [] };
}

/** しらべるの費用。発見の判定は `handleSearch` 側 (エントロピーが要るため)。 */
export const SEARCH_POWER_COST = SEARCH_TUNING.powerCost;
