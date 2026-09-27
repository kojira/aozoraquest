/**
 * dev 専用の管理データ API (#695)。docs/issue-695-admin-data-api.md が正本。
 *
 *   GET /api/admin/data/<name>  → { name, collection, cid, value[, placementIssues] }
 *   PUT /api/admin/data/<name>  body { value, swapCid, dryRun? }
 *
 * **本番と共通の管理データを書き換える** (管理レコードは env で分かれていない)。
 * ADMIN_DATA_API_ENABLED="1" かつ ADMIN_DATA_API_KEY がある時だけ動き、無効・鍵違い・
 * 対象外 name はすべて null を返す (呼び出し側は通常の not_found 404 に倒す)。
 */
import {
  captureNpcPlacementWorld, danglingRefs, decodeWorldMap, describeDanglingRef, allGates, allInteriors,
  npcStructuralPlacementError, sameNpcPosition, setInteriors, setShopOverrides, shopOverrides,
  validateGameQuests, validateNpcPlacement, validateNpcs, validateScenario,
  type GameQuestDef, type Gate, type InteriorMap, type NpcDef, type ScenarioEvent, type ShopOverride,
} from '@aozoraquest/core';
import { getRecord, PdsError } from './pds';
import { readServerTokens } from './oauth-store';
import { serverPutRecord, ServerWriteError, type ServerPdsEnv } from './server-pds';
import { ensureAuthoredWorld, resetAuthoredWorldCache, type WorldAuthoringEnv } from './world-authoring';

export interface AdminDataEnv extends ServerPdsEnv, WorldAuthoringEnv {
  /** "1" の時だけ有効 ([env.dev.vars])。 */
  ADMIN_DATA_API_ENABLED?: string;
  /** Bearer 鍵 (dev secret)。 */
  ADMIN_DATA_API_KEY?: string;
}

const PATH_PREFIX = '/api/admin/data/';
/** 管理レコードの NSID の根。edge の nsidRoot / web の ADMIN_COL と同じ (env で分けない)。 */
const NSID_ROOT = 'app.aozoraquest';
const RKEY = 'self';
const ADMIN_DATA_NAMES = ['npcs', 'shops', 'quests', 'scenario', 'interiors'] as const;
type AdminDataName = (typeof ADMIN_DATA_NAMES)[number];

const collectionOf = (name: AdminDataName) => `${NSID_ROOT}.world.${name}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 定数時間比較 (長さの違いも漏らさないよう両方を SHA-256 してから全バイト比べる)。 */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(ha!), y = new Uint8Array(hb!);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** 有効かつ鍵一致の時だけ true。無効・鍵なし・鍵違いの区別は外に出さない。 */
async function authorized(req: Request, env: AdminDataEnv): Promise<boolean> {
  if (env.ADMIN_DATA_API_ENABLED !== '1' || !env.ADMIN_DATA_API_KEY) return false;
  const h = req.headers.get('authorization') ?? '';
  if (!h.startsWith('Bearer ')) return false;
  return sameSecret(h.slice('Bearer '.length), env.ADMIN_DATA_API_KEY);
}

class AdminDataError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** 書き込み先 = サーバー OAuth トークンの repo。世界を読む主管理者 (ADMIN_DIDS 先頭) と違えば書かない。 */
async function adminRepo(env: AdminDataEnv): Promise<{ did: string; pdsUrl: string }> {
  if (!env.OAUTH_TOKENS) throw new AdminDataError('KV 未 binding', 503);
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) throw new AdminDataError('サーバートークン未 bootstrap', 503);
  const primary = (env.ADMIN_DIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  if (tokens.did !== primary) throw new AdminDataError('サーバートークンの DID が主管理者と違う', 503);
  return { did: tokens.did, pdsUrl: tokens.pdsUrl };
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** レコードが無い/配列でない時は空。 */
function listOf<T>(value: unknown, key: string): T[] {
  const v = (value as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 保存済みの管理レコードを全部読み直して core に入れる (検証が他のレコードの実在を引くため)。 */
async function loadSavedWorld(env: AdminDataEnv, now: number): Promise<void> {
  resetAuthoredWorldCache();
  await ensureAuthoredWorld(env, NSID_ROOT, now);
}

/** NPC の配置問題 (全員の構造検査 + 指定した NPC の配置検査)。 */
function npcPlacementIssues(npcs: NpcDef[], checkPlacement: (n: NpcDef) => boolean): Array<{ id: string; reason: string }> {
  const world = captureNpcPlacementWorld(npcs, false);
  const out: Array<{ id: string; reason: string }> = [];
  for (const n of npcs) {
    const reason = npcStructuralPlacementError(world, n) ?? (checkPlacement(n) ? validateNpcPlacement(world, n, npcs).reason : null);
    if (reason) out.push({ id: n.id, reason });
  }
  return out;
}

/** 候補値を管理画面と同じ検証にかける。壊れていれば理由の文字列を返す。
 *  差し替えて検証する shops / interiors は、終わったら保存済みの値へ戻す。 */
async function validateCandidate(name: AdminDataName, value: unknown, saved: unknown): Promise<string | null> {
  if (name === 'npcs') {
    const npcs = listOf<NpcDef>(value, 'npcs');
    validateNpcs(npcs);
    const dangling = danglingRefs('npc', npcs.map((n) => n.id))[0];
    if (dangling) return describeDanglingRef(dangling);
    const before = listOf<NpcDef>(saved, 'npcs');
    const moved = (n: NpcDef) => { const old = before.find((o) => o.id === n.id); return !old || !sameNpcPosition(n, old); };
    const issue = npcPlacementIssues(npcs, moved)[0];
    return issue ? `${issue.id}: ${issue.reason}` : null;
  }
  if (name === 'quests') {
    const quests = listOf<GameQuestDef>(value, 'quests');
    validateGameQuests(quests);
    const dangling = danglingRefs('quest', quests.map((q) => q.id))[0];
    return dangling ? describeDanglingRef(dangling) : null;
  }
  if (name === 'scenario') { validateScenario(listOf<ScenarioEvent>(value, 'events')); return null; }
  if (name === 'shops') {
    const prev = shopOverrides();
    try { setShopOverrides(listOf<ShopOverride>(value, 'shops')); } finally { setShopOverrides(prev); }
    return null;
  }
  const maps: InteriorMap[] = [];
  for (const m of listOf<Omit<InteriorMap, 'tiles'> & { gz: string }>(value, 'interiors')) {
    const { gz, ...rest } = m;
    if (typeof gz !== 'string') return `${rest.id ?? '(id なし)'}: gz が無い`;
    maps.push({ ...rest, tiles: await decodeWorldMap(fromBase64(gz)) });
  }
  const prevMaps = allInteriors(), prevGates = allGates();
  try { setInteriors(maps, listOf<Gate>(value, 'gates')); } finally { setInteriors(prevMaps, prevGates); }
  return null;
}

/**
 * /api/admin/data/<name> を処理する。**null = このルートは存在しない扱い** (呼び出し側が
 * 通常の not_found 404 を返す)。無効・鍵なし・鍵違い・対象外 name・対象外メソッドが該当。
 */
export async function handleAdminData(req: Request, env: AdminDataEnv, now: number): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  if (!path.startsWith(PATH_PREFIX)) return null;
  const name = path.slice(PATH_PREFIX.length) as AdminDataName;
  if (!ADMIN_DATA_NAMES.includes(name) || (req.method !== 'GET' && req.method !== 'PUT')) return null;
  if (!(await authorized(req, env))) return null;
  try {
    const repo = await adminRepo(env);
    const collection = collectionOf(name);
    const saved = await getRecord<Record<string, unknown>>(repo.pdsUrl, repo.did, collection, RKEY);
    await loadSavedWorld(env, now);
    if (req.method === 'GET') {
      const body: Record<string, unknown> = { name, collection, cid: saved?.cid ?? null, value: saved?.value ?? null };
      if (name === 'npcs') body.placementIssues = npcPlacementIssues(listOf<NpcDef>(saved?.value, 'npcs'), () => true);
      return json(body);
    }
    return await putAdminData(req, env, now, name, saved);
  } catch (e) {
    if (e instanceof AdminDataError) return json({ error: 'admin_data_failed', message: e.message }, e.status);
    if (e instanceof ServerWriteError) return json({ error: 'server_write_unavailable', message: e.message }, 503);
    throw e;
  }
}

/** PUT: 検証 → (dryRun なら返す) → swapCid で CAS 書き込み → edge のキャッシュを捨てる。 */
async function putAdminData(req: Request, env: AdminDataEnv, now: number, name: AdminDataName, saved: { cid: string; value: unknown } | null): Promise<Response> {
  let body: { value?: unknown; swapCid?: unknown; dryRun?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json({ error: 'invalid_body', message: 'JSON でない' }, 400); }
  const value = body?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'invalid_body', message: 'value はオブジェクト' }, 400);
  if (body.swapCid !== null && typeof body.swapCid !== 'string') return json({ error: 'invalid_body', message: 'swapCid は必須 (文字列、未作成なら null)' }, 400);
  let reason: string | null;
  try { reason = await validateCandidate(name, value, saved?.value ?? null); } catch (e) { reason = e instanceof Error ? e.message : String(e); }
  if (reason) return json({ error: 'validation_failed', message: reason }, 400);
  if (body.dryRun === true) return json({ ok: true, dryRun: true });
  const collection = collectionOf(name);
  const record = { ...(value as Record<string, unknown>), $type: collection, updatedAt: new Date(now * 1000).toISOString() };
  try {
    const { cid } = await serverPutRecord(env, now, collection, RKEY, record, body.swapCid);
    resetAuthoredWorldCache();
    return json({ ok: true, cid });
  } catch (e) {
    if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') return json({ error: 'swap_conflict', message: '保存済みの CID が変わった。get し直す' }, 409);
    throw e;
  }
}
