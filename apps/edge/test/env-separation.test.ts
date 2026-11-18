/**
 * D-ENV-002: サーバー repo の権威レコード (gameState / battleGuard) は Worker env で dev と本番を分ける。
 *
 * world.* と同じ 1 つの規則 (adminNsidRoot(env) = ADMIN_NSID_ENV) で決め、**リクエストの Origin では
 * 決めない**。dev エッジは Origin 無し・本番の Origin・ブラウザ以外の呼び出しでも本番のレコードに触れない。
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base58, base64urlnopad } from '@scure/base';
import { LXM } from '@aozoraquest/core';
import { handleRequest, type Env } from '../src/router';
import { writeServerTokens } from '../src/oauth-store';
import { initSecp256k1 } from '../src/secp256k1-wasm';
import { rkeyForDid, XP_EPOCH, type GameState } from '../src/game-state';

beforeAll(() => {
  initSecp256k1(readFileSync(new URL('../src/vendor/secp256k1-verify/secp256k1_verify_bg.wasm', import.meta.url)));
});

const USER = 'did:plc:envsepuser';
const SERVER_DID = 'did:plc:testserver';
const SERVER_PDS = 'https://server-pds.example';
const USER_PDS = 'https://user-pds.example';
const DEV_GS = 'app.aozoraquest.dev.gameState';
const PROD_GS = 'app.aozoraquest.gameState';
const DEV_GUARD = 'app.aozoraquest.dev.battleGuard';
const PROD_GUARD = 'app.aozoraquest.battleGuard';
const AUD = 'did:web:edge.test';
const now = () => Math.floor(Date.now() / 1000);

const userPriv = p256.utils.randomPrivateKey();
const userMultikey = 'z' + base58.encode(new Uint8Array([0x80, 0x24, ...p256.getPublicKey(userPriv, true)]));

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
const b64 = (o: unknown) => base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(o)));
function serviceJwt(lxm: string): string {
  const head = b64({ alg: 'ES256', typ: 'JWT' });
  const body = b64({ iss: USER, aud: AUD, lxm, exp: now() + 60, iat: now() });
  const sig = p256.sign(sha256(new TextEncoder().encode(`${head}.${body}`)), userPriv, { lowS: true }).toCompactRawBytes();
  return `${head}.${body}.${base64urlnopad.encode(sig)}`;
}

/** ADMIN_NSID_ENV: dev エッジ = "dev" (wrangler.toml [env.dev.vars])、本番 = 未設定。 */
async function edgeEnv(adminNsidEnv: string | undefined): Promise<Env> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: now() + 3600, pdsUrl: SERVER_PDS, authServer: 'https://bsky.social', updatedAt: now() });
  return { SERVER_DID, WORKER_DID: AUD, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), OAUTH_TOKENS: kv, ...(adminNsidEnv ? { ADMIN_NSID_ENV: adminNsidEnv } : {}) };
}

const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, activeQuests: [], power: 7, playerXp: 0, jobXp: {}, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

/** サーバー PDS のふり。collection ごとに 1 件 (rkey は本人) を持ち、触った collection を記録する。 */
function serverPds(seed: Record<string, GameState | object>) {
  const store = new Map<string, { value: unknown; cid: string }>(Object.entries(seed).map(([c, v]) => [c, { value: v, cid: `seed-${c}` }]));
  const touched: Array<{ op: 'get' | 'put' | 'delete'; collection: string }> = [];
  const userReads: string[] = [];
  let n = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://plc.directory/')) {
      return json(200, { id: USER, verificationMethod: [{ id: `${USER}#atproto`, type: 'Multikey', publicKeyMultibase: userMultikey }], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: USER_PDS }] });
    }
    if (url.startsWith(USER_PDS)) { // ユーザー repo (移行元) は空。読んだ collection を記録する
      userReads.push(new URL(url).searchParams.get('collection')!);
      return json(400, { error: 'RecordNotFound' });
    }
    if (url.startsWith(`${SERVER_PDS}/xrpc/com.atproto.repo.getRecord?`)) {
      const q = new URL(url).searchParams;
      const col = q.get('collection')!;
      touched.push({ op: 'get', collection: col });
      expect(q.get('rkey')).toBe(rkeyForDid(USER));
      const rec = store.get(col);
      return rec ? json(200, { uri: 'at://x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    if (url.includes('com.atproto.repo.putRecord')) {
      touched.push({ op: 'put', collection: b.collection });
      const cur = store.get(b.collection);
      if ((b.swapRecord === null && cur) || (typeof b.swapRecord === 'string' && cur?.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      const cid = `c${++n}`;
      store.set(b.collection, { value: b.record, cid });
      return json(200, { uri: 'at://x', cid });
    }
    if (url.includes('com.atproto.repo.deleteRecord')) {
      touched.push({ op: 'delete', collection: b.collection });
      store.delete(b.collection);
      return json(200, {});
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store, touched, userReads };
}

function call(path: string, lxm: string, origin: string | null, method = 'POST', body?: unknown): Request {
  const headers: Record<string, string> = { authorization: `Bearer ${serviceJwt(lxm)}`, 'content-type': 'application/json' };
  if (origin) headers.origin = origin;
  return new Request(`https://edge.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

const ORIGINS = [null, 'https://aozoraquest.app', 'https://dev.aozoraquest.app', 'http://127.0.0.1:9999', 'https://evil.example'] as const;

describe('D-ENV-002: gameState / battleGuard の collection は Worker env で決まる', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  for (const origin of ORIGINS) {
    it(`dev エッジ (ADMIN_NSID_ENV=dev, Origin=${origin ?? 'なし'}) は dev の gameState だけを読み書きし、本番には触れない`, async () => {
      const env = await edgeEnv('dev');
      const pds = serverPds({ [PROD_GS]: GS({ power: 999 }) });
      globalThis.fetch = pds.fn;

      const read = await handleRequest(call('/api/me/state', LXM.meState, origin, 'GET'), env);
      expect(read.status).toBe(200);
      const st = (await read.json()) as { state: GameState; initialized: boolean };
      expect(st.initialized).toBe(false); // 本番の power=999 を読んでいない
      expect(st.state.power).not.toBe(999);

      const write = await handleRequest(call('/api/world/gear', LXM.worldGear, origin, 'POST', { gear: {} }), env);
      expect(write.status).toBe(200);
      expect(pds.store.has(DEV_GS)).toBe(true);
      expect(pds.store.get(PROD_GS)).toEqual({ value: GS({ power: 999 }), cid: `seed-${PROD_GS}` });

      const cols = new Set(pds.touched.map((t) => t.collection));
      expect(cols.has(PROD_GS)).toBe(false);
      expect(cols.has(PROD_GUARD)).toBe(false);
      expect(cols.has(DEV_GS)).toBe(true);
    });
  }

  for (const [label, adminNsidEnv, ns] of [['dev', 'dev', 'app.aozoraquest.dev'], ['本番', undefined, 'app.aozoraquest']] as const) {
    for (const origin of ORIGINS) {
      it(`${label}エッジ (Origin=${origin ?? 'なし'}) がユーザー repo から読む移行元は ${ns}.* だけ`, async () => {
        const env = await edgeEnv(adminNsidEnv);
        const pds = serverPds({});
        globalThis.fetch = pds.fn;
        const res = await handleRequest(call('/api/me/state', LXM.meState, origin, 'GET'), env);
        expect(res.status).toBe(200);
        expect(pds.userReads.sort()).toEqual([`${ns}.analysis`, `${ns}.power`, `${ns}.world`]);
      });
    }
  }

  it('本番エッジ (ADMIN_NSID_ENV 未設定) は app.aozoraquest.gameState を読み書きする (今と同じ名前)', async () => {
    const env = await edgeEnv(undefined);
    const pds = serverPds({ [PROD_GS]: GS({ power: 999 }) });
    globalThis.fetch = pds.fn;
    const read = await handleRequest(call('/api/me/state', LXM.meState, 'https://aozoraquest.app', 'GET'), env);
    const st = (await read.json()) as { state: GameState; initialized: boolean };
    expect(st).toMatchObject({ initialized: true, state: { power: 999 } });
    const write = await handleRequest(call('/api/world/gear', LXM.worldGear, 'https://aozoraquest.app', 'POST', { gear: {} }), env);
    expect(write.status).toBe(200);
    expect(pds.touched.filter((t) => t.op === 'put').map((t) => t.collection)).toEqual([PROD_GS]);
    expect(pds.store.has(DEV_GS)).toBe(false);
  });

  it('dev エッジのリセット (/api/world/reset) は dev の gameState と battleGuard だけを消す', async () => {
    const env = await edgeEnv('dev');
    const guard = { did: USER, battleId: 'b', turn: 0 };
    const pds = serverPds({ [PROD_GS]: GS({ power: 999 }), [PROD_GUARD]: guard, [DEV_GS]: GS(), [DEV_GUARD]: guard });
    globalThis.fetch = pds.fn;
    const res = await handleRequest(call('/api/world/reset', LXM.worldReset, 'https://aozoraquest.app', 'POST', {}), env);
    expect(res.status).toBe(200);
    expect(pds.touched.filter((t) => t.op === 'delete').map((t) => t.collection).sort()).toEqual([DEV_GS, DEV_GUARD].sort());
    expect(pds.store.has(PROD_GS)).toBe(true);
    expect(pds.store.has(PROD_GUARD)).toBe(true);
  });

  it('本番エッジのリセットは本番の gameState と battleGuard を消す', async () => {
    const env = await edgeEnv(undefined);
    const guard = { did: USER, battleId: 'b', turn: 0 };
    const pds = serverPds({ [PROD_GS]: GS(), [PROD_GUARD]: guard, [DEV_GS]: GS(), [DEV_GUARD]: guard });
    globalThis.fetch = pds.fn;
    const res = await handleRequest(call('/api/world/reset', LXM.worldReset, 'https://dev.aozoraquest.app', 'POST', {}), env);
    expect(res.status).toBe(200);
    expect(pds.touched.filter((t) => t.op === 'delete').map((t) => t.collection).sort()).toEqual([PROD_GS, PROD_GUARD].sort());
    expect(pds.store.has(DEV_GS)).toBe(true);
  });
});
