/**
 * しらべる (`POST /api/world/search`)。battle-resolver から分けた (D-STORY-009)。
 * 判定・消費・付与はすべて edge が権威。
 */
import { jobLevelFromXp, playerLevelFromXp, playerCombatant, rollSearch, regionOf, tierForRegion, interiorById, WORLD_MAP_ID, MAX_FLAGS, placedItemAt, placedItemAvailable, type PlacedItemDef } from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readState, readModifyWrite, type GameState } from './game-state';
import { advanceScenario, type ScenarioMessage, type ScenarioResult } from './scenario-progress';
import { SEARCH_POWER_COST, MAX_SHOP_OPS } from './shop';
import { verifyPosition } from './world-token';
import { DEFAULT_NS, ResolverError, jobXpOf, migrateInitState, readDiagnosis, type ResolverEnv } from './battle-resolver';

export interface SearchResult {
  found: string | null;
  materials: Record<string, number>;
  power: number;
  /** 置きアイテムを取ったときだけ (D-STORY-009)。パワーは減らない。 */
  placed?: { itemId: string; count: number };
  /** 置きアイテムを取ったときだけ: 立てたフラグを含む進行フラグ。 */
  flags?: string[];
  /** 置きアイテムで発火したシナリオのお知らせ。 */
  scenarioMessages?: ScenarioMessage[];
}

/**
 * 置きアイテムを取る。条件 (requireFlags がそろい、flag が未設定) を readModifyWrite の中で
 * 確かめ直してから、アイテムと flag を同時に付与する。取れなければ null (普段のしらべるへ)。
 * 同じ opKey の再送は、取った結果をもう一度返す (二重には付与しない)。
 */
async function takePlacedItem(env: ResolverEnv, userDid: string, item: PlacedItemDef, now: number, init: (d: string, iso: string) => Promise<GameState>, key: string | null): Promise<SearchResult | null> {
  let took = false;
  const scenarioBox: { v: ScenarioResult | null } = { v: null };
  const written = await readModifyWrite(env, userDid, (cur) => {
    took = false;
    scenarioBox.v = null;
    const flags = cur.flags ?? [];
    if (key && (cur.shopOps ?? []).includes(key)) { took = true; return cur; } // 処理済みの再送
    if (!placedItemAvailable(item, flags)) return cur;
    took = true;
    const next: GameState = {
      ...cur,
      materials: { ...cur.materials, [item.itemId]: (cur.materials[item.itemId] ?? 0) + item.count },
      flags: [...flags, item.flag].slice(-MAX_FLAGS),
      ...(key ? { shopOps: [...(cur.shopOps ?? []), key].slice(-MAX_SHOP_OPS) } : {}),
    };
    scenarioBox.v = advanceScenario(next);
    return scenarioBox.v ? { ...next, flags: scenarioBox.v.flags } : next;
  }, { now, init });
  if (!took) return null;
  return {
    found: item.itemId, materials: written.materials, power: written.power,
    placed: { itemId: item.itemId, count: item.count }, flags: written.flags ?? [],
    ...(scenarioBox.v?.messages.length ? { scenarioMessages: scenarioBox.v.messages } : {}),
  };
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
  // **置きアイテム (D-STORY-009) はパワー判定より前。** 取れたらパワーは消費しない。
  // 冪等キーは普段のしらべると分ける (再送がどちらの結果か取り違えない)。
  const placed = placedItemAt(mapId, x, y);
  const placedKey = opKey ? `placed:${opKey}` : null;
  if (placed && (placedItemAvailable(placed, state.flags ?? []) || (placedKey && (state.shopOps ?? []).includes(placedKey)))) {
    const got = await takePlacedItem(env, userDid, placed, now, (d, iso) => migrateInitState(d, iso, ns, fetchImpl), placedKey);
    if (got) return got;
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
