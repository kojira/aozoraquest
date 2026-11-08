/**
 * しらべる (`POST /api/world/search`)。battle-resolver から分けた (D-STORY-009)。
 * 判定・消費・付与はすべて edge が権威。
 */
import { jobLevelFromXp, playerLevelFromXp, playerCombatant, rollSearch, regionOf, tierForRegion, interiorById, WORLD_MAP_ID, MAX_FLAGS, placedItemAt, placedItemOpen, placedItemTaken, placedKind, placedRewards, placedSearchOutcome, type PlacedItemDef, type PlacedKind, type PlacedReward } from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readState, readModifyWrite, MAX_OPENED_SPOTS, type GameState, type OwnedPiece } from './game-state';
import { advanceScenario, type ScenarioMessage, type ScenarioResult } from './scenario-progress';
import { SEARCH_POWER_COST, MAX_SHOP_OPS, MAX_OWNED_PIECES } from './shop';
import { verifyPosition } from './world-token';
import { DEFAULT_NS, ResolverError, jobXpOf, migrateInitState, readDiagnosis, type ResolverEnv } from './battle-resolver';

export interface SearchResult {
  found: string | null;
  materials: Record<string, number>;
  power: number;
  /** 置きアイテムを取ったときだけ (D-STORY-009 / D-CHEST-001)。パワーは減らない。
   *  itemId/count は spot の古い応答との互換のために残す。 */
  placed?: { kind: PlacedKind; rewards: PlacedReward[]; itemId?: string; count?: number };
  /** 置きアイテムを取ったときだけ: 立てたフラグを含む進行フラグ。 */
  flags?: string[];
  /** 置きアイテムを取ったときだけ: 開けた宝箱・取ったキラキラの id。 */
  openedSpots?: string[];
  /** 置きアイテムを取ったときだけ: 装備の個体 (宝箱から装備が出ると増える)。 */
  pieces?: OwnedPiece[];
  /** 無料で何も起きないマス: 開封済みの宝箱 (empty) / 鍵がかかっている (locked)。 */
  placedState?: 'empty' | 'locked';
  /** placedState のときに出す 1 行 (管理データの hint)。 */
  hint?: string;
  /** 置きアイテムで発火したシナリオのお知らせ。 */
  scenarioMessages?: ScenarioMessage[];
}

/** 宝箱から出る装備の rkey。決まった値なので、同じ宝箱から二重に作られない。 */
function chestPieceRkey(placedId: string, index: number): string {
  return index === 0 ? `chest-${placedId}` : `chest-${placedId}-${index}`;
}

/** 報酬を state に加える (純関数)。持ち物がいっぱいなら開けない (開封済みにもしない)。 */
function grantPlacedRewards(cur: GameState, item: PlacedItemDef): GameState {
  const rewards = placedRewards(item);
  const materials = { ...cur.materials };
  const pieces = [...(cur.pieces ?? [])];
  let power = cur.power;
  rewards.forEach((r, i) => {
    if ('item' in r) materials[r.item] = (materials[r.item] ?? 0) + r.count;
    else if ('power' in r) power += r.power;
    else {
      const rkey = chestPieceRkey(item.id, i);
      if (pieces.some((p) => p.rkey === rkey)) return;
      if (pieces.length >= MAX_OWNED_PIECES) throw new ResolverError('もちものが いっぱいだ。', 400, 'pieces_full');
      pieces.push({ rkey, itemId: r.equipment, level: 0 });
    }
  });
  const opened = cur.openedSpots ?? [];
  const recordOpened = placedKind(item) !== 'spot' || item.flag === undefined;
  if (recordOpened && opened.length >= MAX_OPENED_SPOTS) {
    console.error('[search] openedSpots が上限に達した', { did: cur.did, id: item.id });
    throw new ResolverError('これ以上 開けられない', 409, 'opened_full');
  }
  const flags = cur.flags ?? [];
  return {
    ...cur,
    power,
    materials,
    ...(pieces.length !== (cur.pieces ?? []).length ? { pieces } : {}),
    ...(recordOpened ? { openedSpots: [...opened, item.id] } : {}),
    ...(item.flag !== undefined ? { flags: [...flags, item.flag].slice(-MAX_FLAGS) } : {}),
  };
}

/** 取った結果の応答の placed (再送のときも同じ形を返す)。 */
function placedResponse(item: PlacedItemDef): NonNullable<SearchResult['placed']> {
  const kind = placedKind(item);
  const rewards = placedRewards(item);
  const first = rewards[0];
  return { kind, rewards, ...(kind === 'spot' && first && 'item' in first ? { itemId: first.item, count: first.count } : {}) };
}

/**
 * 置きアイテムを取る。条件 (requireFlags がそろい、まだ取っていない) を readModifyWrite の中で
 * 確かめ直してから、報酬・openedSpots・flag を一度に付与する。取れなければ result は null。
 * 同じ opKey の再送は、取った結果をもう一度返す (二重には付与しない)。
 */
async function takePlacedItem(env: ResolverEnv, userDid: string, item: PlacedItemDef, now: number, init: (d: string, iso: string) => Promise<GameState>, key: string | null): Promise<{ result: SearchResult | null; state: GameState }> {
  let took = false;
  const scenarioBox: { v: ScenarioResult | null } = { v: null };
  const written = await readModifyWrite(env, userDid, (cur) => {
    took = false;
    scenarioBox.v = null;
    const done = !!key && (cur.shopOps ?? []).includes(key);
    // 処理済みの再送は、このマスを取った後のときだけ (同じ opKey で別のマスを取った後なら普段どおり取る)。
    if (done && placedItemTaken(item, cur.flags ?? [], cur.openedSpots ?? [])) { took = true; return cur; }
    if (!placedItemOpen(item, cur.flags ?? [], cur.openedSpots ?? [])) return cur;
    took = true;
    const next: GameState = { ...grantPlacedRewards(cur, item), ...(key && !done ? { shopOps: [...(cur.shopOps ?? []), key].slice(-MAX_SHOP_OPS) } : {}) };
    scenarioBox.v = advanceScenario(next);
    return scenarioBox.v ? { ...next, flags: scenarioBox.v.flags } : next;
  }, { now, init });
  if (!took) return { result: null, state: written };
  const first = placedRewards(item).find((r) => 'item' in r);
  return { state: written, result: {
    found: first && 'item' in first ? first.item : null, materials: written.materials, power: written.power,
    placed: placedResponse(item), flags: written.flags ?? [], openedSpots: written.openedSpots ?? [], pieces: written.pieces ?? [],
    ...(scenarioBox.v?.messages.length ? { scenarioMessages: scenarioBox.v.messages } : {}),
  } };
}

/** 空の宝箱・鍵のマス: 書き込みなしで返す。パワーは減らない。 */
function freePlacedResult(state: GameState, item: PlacedItemDef, placedState: 'empty' | 'locked'): SearchResult {
  return { found: null, materials: state.materials, power: state.power, placedState, ...(item.hint ? { hint: item.hint } : {}) };
}

/** しらべる: サーバーが luk (装備込み) + tier (位置) + 物理乱数で判定し、当たれば gameState.materials に付与。
 *  これで拾ったアイテムがサーバー在庫の正になる (client のみの幻ではなくなる)。
 *  **パワーの消費も権威側** (#551) — client の台帳だけで引いていた頃は、いくらでも しらべられた。 */
export async function handleSearch(env: ResolverEnv, userDid: string, token: string | undefined, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch, opKey?: string): Promise<SearchResult> {
  let x: number, y: number;
  let mapId: string = WORLD_MAP_ID;
  try {
    const c = verifyPosition(env, token ?? '', userDid, now);
    x = c.x; y = c.y; mapId = c.mapId ?? WORLD_MAP_ID;
  } catch {
    const rec = await readState(env, userDid);
    const s = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
    x = s.x; y = s.y; mapId = s.mapId ?? WORLD_MAP_ID;
  }
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const key = opKey ? `search:${opKey}` : null;
  // **置きアイテム (D-STORY-009 / D-CHEST-001) はパワー判定より前。** 取る・空の宝箱・鍵はパワーを使わない。
  // 冪等キーは普段のしらべると分ける (再送がどちらの結果か取り違えない)。
  const placed = placedItemAt(mapId, x, y);
  const placedKey = opKey ? `placed:${opKey}` : null;
  if (placed) {
    let outcome = placedSearchOutcome(placed, state.flags ?? [], state.openedSpots ?? []);
    let latest = state;
    const replay = !!placedKey && (state.shopOps ?? []).includes(placedKey) && placedItemTaken(placed, state.flags ?? [], state.openedSpots ?? []);
    if (outcome === 'take' || replay) {
      const got = await takePlacedItem(env, userDid, placed, now, (d, iso) => migrateInitState(d, iso, ns, fetchImpl), placedKey);
      if (got.result) return got.result;
      latest = got.state; // 割り込みで取れなくなった: 最新の state で決め直す
      outcome = placedSearchOutcome(placed, latest.flags ?? [], latest.openedSpots ?? []);
    }
    if (outcome === 'empty' || outcome === 'locked') return freePlacedResult(latest, placed, outcome);
  }
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const luk = playerCombatant(archetype, jobLevelFromXp(jobXpOf(state, archetype), archetype), playerLevelFromXp(playerXp), handle, baseStats, undefined, state.gearSel).luk;
  // 内部マップ (#424) の座標はローカル系で region が常に 0 になるため、
  // 危険度は内部マップの設定を使う (フィールドは従来どおり地域から)。
  const interiorHere = mapId !== WORLD_MAP_ID ? interiorById(mapId) : undefined;
  const tier = (interiorHere?.encounterTier ?? tierForRegion(regionOf(x, y))) as ReturnType<typeof tierForRegion>;
  // **パワーは権威側から引く** (#551)。それまで消費は client の台帳だけで、権威 state の
  // power は動いていなかった = いくらでも しらべられた。
  if (state.power < SEARCH_POWER_COST) throw new ResolverError('あおぞらパワーが たりない', 400, 'no_power');
  const found = rollSearch((await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value, luk, tier);
  // **冪等キー** (#551 レビュー指摘)。応答だけ落ちて client が押し直すと、無キーだと
  // 権威側は 2 回引かれるのに画面は 1 回ぶんしか反映されない = 「パワーが勝手に消えた」。
  const written = await readModifyWrite(env, userDid, (cur) => {
    if (key && (cur.shopOps ?? []).includes(key)) return cur; // 処理済み: 何も引かない
    // 再読み込み後にも残高を確かめる (CAS リトライで別の消費が割り込みうる)。
    if (cur.power < SEARCH_POWER_COST) throw new ResolverError('あおぞらパワーが たりない', 400, 'no_power');
    const materials = found ? { ...cur.materials, [found]: (cur.materials[found] ?? 0) + 1 } : cur.materials;
    return {
      ...cur,
      power: cur.power - SEARCH_POWER_COST,
      materials,
      ...(key ? { shopOps: [...(cur.shopOps ?? []), key].slice(-MAX_SHOP_OPS) } : {}),
    };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { found, materials: written.materials, power: written.power };
}
