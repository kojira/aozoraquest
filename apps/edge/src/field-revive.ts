/**
 * フィールドで倒れた仲間を起こす・回復のどうぐを使う (D-REVIVE-001)。router.ts からは 1 行で呼ぶ。
 * - `POST /api/world/use {itemId, target, rkey}`: 戦闘のどうぐのうち、回復 (決まった量) と生き返らせるどうぐを
 *   フィールドで 1 つ使う。相手は 'hero' か仲間の id。生き返らせるどうぐは倒れた仲間にだけ。
 * - `POST /api/shrine/pray {rkey, token}`: ほこら のマスで おそなえ を払い、倒れた仲間をみんな最大 HP の半分で起こす。
 * どちらもサーバーが確かめて権威 state を書く。同じ rkey は 1 回だけ (shopOps)。
 */
import { ITEMS, LXM, createRng, itemHealAmount, SHRINE_REVIVE_RATIO, WORLD_MAP_ID, effectTarget, partyDefsOf, partyMemberCombatant, recruitById, shrineAt } from '@aozoraquest/core';
import { downedIds, readModifyWrite, readState, type GameState } from './game-state';
import { ResolverError, migrateInitState, type ResolverEnv } from './battle-resolver';
import { HERO_TARGET, fieldHealSeed, heroOf, membersOf, pick, withHealBond, withVitals } from './field-heal';
import { MAX_SHOP_OPS } from './shop';
import { verifyServiceAuth, ServiceAuthError } from './service-auth';
import { ensureAuthoredWorld, type WorldAuthoringEnv } from './world-authoring';
import { positionAndState } from './story-battle';
import type { AllyBondUp } from './party-bond';

const PATHS: Record<string, string> = { '/api/world/use': LXM.worldItem, '/api/shrine/pray': LXM.shrinePray };
type Env = ResolverEnv & WorldAuthoringEnv & { WORKER_DID?: string };

export interface FieldUseResult {
  itemId: string;
  target: string;
  name: string;
  amount: number;
  revived: boolean;
  materials: Record<string, number>;
  carryHp?: number;
  party?: GameState['party'];
  duplicate?: boolean;
  allyBondUp?: AllyBondUp[];
}

const assertRkey = (rkey: unknown): string => {
  if (typeof rkey !== 'string' || !rkey || rkey.length > 128) throw new ResolverError('rkey が不正', 400, 'bad_request');
  return rkey;
};
const withOp = (cur: GameState, op: string) => [...(cur.shopOps ?? []), op].slice(-MAX_SHOP_OPS);

/** フィールドで 回復・生き返らせるどうぐ を 1 つ使う。 */
export async function handleFieldUse(env: ResolverEnv, did: string, input: { itemId?: unknown; target?: unknown; rkey?: unknown }, now: number, ns: string, fetchImpl?: typeof fetch): Promise<FieldUseResult> {
  const rkey = assertRkey(input.rkey);
  const itemId = input.itemId;
  const target = input.target ?? HERO_TARGET;
  if (typeof itemId !== 'string' || typeof target !== 'string') throw new ResolverError('入力が不正', 400, 'bad_request');
  const heal = ITEMS[itemId]?.battle?.effects.find((e) => e.kind === 'heal');
  if (heal?.kind !== 'heal' || heal.amount === undefined || effectTarget(heal) === 'allAllies') throw new ResolverError('フィールドで つかえない どうぐ', 400, 'not_field_item');
  const revive = effectTarget(heal) === 'oneDownAlly';
  const rec = await readState(env, did);
  const state = rec?.state ?? (await migrateInitState(did, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const { hero, jobLevel } = await heroOf(did, state, ns, fetchImpl);
  const op = `use:${rkey}`;
  const seed = await fieldHealSeed(env);
  let out: Omit<FieldUseResult, 'materials' | 'carryHp' | 'party'> = { itemId, target, name: '', amount: 0, revived: revive };
  const written = await readModifyWrite(env, did, (cur) => {
    if ((cur.shopOps ?? []).includes(op)) { out = { ...out, duplicate: true }; return cur; }
    const have = cur.materials[itemId] ?? 0;
    if (have <= 0) throw new ResolverError(`${ITEMS[itemId]!.name}を もっていない`, 400, 'no_item');
    const to = pick(membersOf(cur, hero, jobLevel), target, 'つかう相手');
    const c = { ...to.c };
    if (revive ? c.hp > 0 : c.hp <= 0) throw new ResolverError(revive ? `${c.name}は たおれていない` : `${c.name}は たおれている`, 400, revive ? 'target_up' : 'target_down');
    if (!revive && c.hp >= c.maxHp) throw new ResolverError('HP は満タン', 400, 'full');
    const hp = Math.min(c.maxHp, c.hp + itemHealAmount(itemId, { luk: hero.luk, rng: createRng(seed) })); // 幅と うん (D-HEAL-RANGE-001)
    out = { ...out, name: c.name, amount: hp - c.hp };
    c.hp = hp;
    const m = { ...cur.materials, [itemId]: have - 1 };
    if (m[itemId]! <= 0) delete m[itemId];
    const bonded = withHealBond(withVitals(cur, to.id, c), HERO_TARGET, [{ id: to.id, amount: out.amount, maxHp: c.maxHp }]);
    if (bonded.deepened.length) out = { ...out, allyBondUp: bonded.deepened };
    return { ...bonded.state, materials: m, shopOps: withOp(cur, op) };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { ...out, materials: written.materials, carryHp: written.carryHp, ...(written.party ? { party: written.party } : {}) };
}

export interface ShrineResult {
  /** 起きた仲間 (名前と HP)。誰も倒れていなければ空で、払わない。 */
  revived: Array<{ id: string; name: string; hp: number }>;
  paid: number;
  power: number;
  party?: GameState['party'];
  /** おそなえ が足りなかった。 */
  denied?: { price: number };
  name?: string;
  duplicate?: boolean;
}

/** ほこら で いのる。 */
export async function handleShrinePray(env: ResolverEnv, did: string, input: { rkey?: unknown; token?: unknown }, now: number, ns: string): Promise<ShrineResult> {
  const rkey = assertRkey(input.rkey);
  const { pos, state } = await positionAndState(env, did, typeof input.token === 'string' ? input.token : undefined, now, ns);
  const shrine = shrineAt(pos.mapId ?? WORLD_MAP_ID, pos.x, pos.y);
  if (!shrine) throw new ResolverError('ほこらの まえに いない', 400, 'not_at_shrine');
  const name = shrine.name ? { name: shrine.name } : {};
  if (downedIds(state.party).length === 0) return { revived: [], paid: 0, power: state.power, ...name };
  if (state.power < shrine.price) return { revived: [], paid: 0, power: state.power, denied: { price: shrine.price }, ...name };
  const { jobLevel } = await heroOf(did, state, ns);
  const op = `shrine:${rkey}`;
  let revived: ShrineResult['revived'] = [];
  let duplicate = false;
  const written = await readModifyWrite(env, did, (cur) => {
    if ((cur.shopOps ?? []).includes(op)) { duplicate = true; return cur; }
    const down = downedIds(cur.party);
    if (down.length === 0) { revived = []; return cur; }
    if (cur.power < shrine.price) throw new ResolverError('パワーが たりない', 400, 'shrine_poor');
    const carry = { ...(cur.party?.hp ? { hp: cur.party.hp } : {}), ...(cur.party?.mp ? { mp: cur.party.mp } : {}) };
    let next: GameState = cur;
    revived = [];
    for (const d of partyDefsOf(cur.party, recruitById, jobLevel)) {
      if (!down.includes(d.id)) continue;
      const c = partyMemberCombatant(d, jobLevel, carry);
      c.hp = Math.max(1, Math.round(c.maxHp * SHRINE_REVIVE_RATIO));
      revived.push({ id: d.id, name: c.name, hp: c.hp });
      next = withVitals(next, d.id, c);
    }
    return { ...next, power: cur.power - shrine.price, shopOps: withOp(cur, op) };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { revived, paid: revived.length && !duplicate ? shrine.price : 0, power: written.power, ...(written.party ? { party: written.party } : {}), ...name, ...(duplicate ? { duplicate } : {}) };
}

/** /api/world/use と /api/shrine/pray を受ける。この道でなければ null。 */
export async function handleFieldReviveRoute(req: Request, url: URL, env: Env, now: number, ns: string, respond: (body: unknown, status?: number) => Response, onError: (e: unknown) => Response): Promise<Response | null> {
  const lxm = req.method === 'POST' ? PATHS[url.pathname] : undefined;
  if (!lxm) return null;
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return respond({ error: 'missing_token' }, 401);
  let did: string;
  try {
    ({ iss: did } = await verifyServiceAuth(token, { audience: env.WORKER_DID ?? 'did:web:edge.aozoraquest.app', lxm }));
  } catch (e) {
    return respond({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401);
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await ensureAuthoredWorld(env, now); // どうぐ・なじみの仲間・ほこら は world.* にある
    if (url.pathname === '/api/shrine/pray') return respond(await handleShrinePray(env, did, body, now, ns));
    return respond(await handleFieldUse(env, did, body, now, ns));
  } catch (e) {
    return onError(e);
  }
}
