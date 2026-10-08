/**
 * しらべる (`POST /api/world/search`)。battle-resolver から分けた (D-STORY-009)。
 * 判定・消費・付与はすべて edge が権威。
 */
import { jobLevelFromXp, playerLevelFromXp, playerCombatant, rollSearch, regionOf, tierForRegion, interiorById, WORLD_MAP_ID } from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readState, readModifyWrite } from './game-state';
import { SEARCH_POWER_COST, MAX_SHOP_OPS } from './shop';
import { verifyPosition } from './world-token';
import { DEFAULT_NS, ResolverError, jobXpOf, migrateInitState, readDiagnosis, type ResolverEnv } from './battle-resolver';

export interface SearchResult { found: string | null; materials: Record<string, number>; power: number }

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
  const key = opKey ? `search:${opKey}` : null;
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
