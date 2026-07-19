/**
 * aozoraquest edge Worker のリクエストハンドラ。
 *
 * 現在:
 *   - GET  /healthz: 起動確認
 *   - GET  /version: ビルド情報 (deploy 検証用)
 *   - POST /api/whoami: service auth JWT を検証して呼び出し元 DID を返す (M1 認証基盤)
 *
 * 予定 (docs/21-server-authority): あおぞらワールドのゲーム経済をサーバー権威化する
 *   /api/battle/* /api/xp/* /api/me/state (M2〜)。依頼クエスト集約 (docs/15) も。
 */
import { verifyServiceAuth, ServiceAuthError } from './service-auth';
import { PdsError } from './pds';
import { readState } from './game-state';
import { handleClientMetadata, handleOAuthStart, handleOAuthCallback, type OAuthRoutesEnv } from './oauth-routes';
import { handleMove, handleTurn, handleTeleport, handleItem, handleGear, handleSearch, migrateInitState, ResolverError } from './battle-resolver';
import { signPosition } from './world-token';
import { ServerWriteError } from './server-pds';
import type { Command } from '@aozoraquest/core';

/** WORKER_DID / SERVER_DID / OAUTH_* / ADMIN_DIDS / OAUTH_TOKENS は OAuthRoutesEnv から継承。 */
export interface Env extends OAuthRoutesEnv {
  ENVIRONMENT?: string;
  /** カンマ区切り。空 or 未設定なら CORS 全許可 (dev 用)。production では必ず設定する */
  ALLOWED_ORIGINS?: string;
  /** 権威 state を置く app サーバーアカウントの PDS URL (public read 用、非 secret)。SERVER_DID は継承。 */
  SERVER_PDS_URL?: string;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/** リクエストの Origin から NSID prefix を決める (#363: edge は 1 デプロイで dev/prod を捌く)。
 *  client の VITE_NSID_ENV と一致させる: dev.aozoraquest.app→`app.aozoraquest.dev`、
 *  localhost→`app.aozoraquest.local`、本番→`app.aozoraquest`。 */
function nsFromOrigin(req: Request): string {
  const origin = req.headers.get('origin') ?? '';
  if (origin.includes('dev.aozoraquest.app')) return 'app.aozoraquest.dev';
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) return 'app.aozoraquest.local';
  return 'app.aozoraquest';
}

/** service auth の lexicon method (lxm)。エンドポイントごとに別値。 */
const LXM_WHOAMI = 'app.aozoraquest.whoami';
const LXM_ME_STATE = 'app.aozoraquest.me.state';
const LXM_WORLD_MOVE = 'app.aozoraquest.world.move';
const LXM_WORLD_TELEPORT = 'app.aozoraquest.world.teleport';
const LXM_WORLD_ITEM = 'app.aozoraquest.world.item';
const LXM_WORLD_GEAR = 'app.aozoraquest.world.gear';
const LXM_WORLD_SEARCH = 'app.aozoraquest.world.search';
const LXM_BATTLE_TURN = 'app.aozoraquest.battle.turn';

const AOZORA_ORIGINS = new Set([
  'https://aozoraquest.app',
  'https://dev.aozoraquest.app',
  // ローカル開発で UI から叩く想定
  'http://localhost:9999',
  'http://127.0.0.1:9999',
]);

function pickOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('origin');
  if (!origin) return null;
  if (env.ALLOWED_ORIGINS) {
    const list = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    return list.includes(origin) ? origin : null;
  }
  return AOZORA_ORIGINS.has(origin) ? origin : null;
}

export async function handleRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const allowedOrigin = pickOrigin(req, env);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return cors(new Response(null, { status: 204 }), allowedOrigin);
  }

  if (req.method === 'GET' && url.pathname === '/healthz') {
    return cors(json({ ok: true }), allowedOrigin);
  }

  if (req.method === 'GET' && url.pathname === '/version') {
    return cors(json({
      name: 'aozoraquest-edge',
      phase: 1,
      commit: globalThis.__COMMIT__ ?? 'dev',
    }), allowedOrigin);
  }

  // service auth JWT を検証して呼び出し元 DID を返す (M1 認証基盤の疎通確認)。
  if (req.method === 'POST' && url.pathname === '/api/whoami') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    try {
      const { iss } = await verifyServiceAuth(token, { audience, lxm: LXM_WHOAMI });
      return cors(json({ did: iss }), allowedOrigin);
    } catch (e) {
      // fail-closed: 検証失敗は 401 (詳細は漏らしすぎない)
      const msg = e instanceof ServiceAuthError ? e.message : 'verify_failed';
      return cors(json({ error: 'unauthorized', reason: msg }, 401), allowedOrigin);
    }
  }

  // 権威 state (ゲーム経済) の読み取り。自分の DID の分だけ返す (JWT で本人確認)。
  // 読みは public getRecord なので session 不要。書き込みは M3 の battle 系で行う。
  if (req.method === 'GET' && url.pathname === '/api/me/state') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_ME_STATE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    // 読み書きとも repo はトークン由来 (readState)。未 bootstrap は 503 fail-closed。
    // 未初期化 (レコード無し) は §6-4 移行値を read-only で返す (power=0/Lv1 で表示が割れないように。
    // PDS へは書かない = 初回 move で確定)。initialized はレコード実在を表す。
    try {
      const rec = await readState(env, did);
      const state = rec?.state ?? (await migrateInitState(did, new Date().toISOString(), nsFromOrigin(req)));
      // 位置トークンも一緒に返す → client は初回から有効トークンを持て、初手 move の再同期/ワープを防ぐ。
      const token = signPosition(env, { did, x: state.x, y: state.y, counter: 0, iat: nowSec() });
      return cors(json({ state, initialized: rec !== null, token }), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // ── サーバー権威 ワールド/戦闘 (docs/21 §5) ── 移動も攻撃も毎回 Worker が処理 = チート不可 ──
  if (req.method === 'POST' && (url.pathname === '/api/world/move' || url.pathname === '/api/battle/turn')) {
    const isTurn = url.pathname === '/api/battle/turn';
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: isTurn ? LXM_BATTLE_TURN : LXM_WORLD_MOVE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { dx?: number; dy?: number; token?: string; battleId?: string; turn?: number; command?: string };
    try {
      if (isTurn) {
        if (typeof body.battleId !== 'string' || typeof body.turn !== 'number' || typeof body.command !== 'string') {
          return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
        }
        return cors(json(await handleTurn(env, did, body.battleId, body.turn, body.command as Command, nowSec(), nsFromOrigin(req))), allowedOrigin);
      }
      if (typeof body.dx !== 'number' || typeof body.dy !== 'number') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
      return cors(json(await handleMove(env, did, body.dx, body.dy, typeof body.token === 'string' ? body.token : undefined, nowSec(), nsFromOrigin(req))), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // そらのはねワープ: 街タイルへテレポート (位置トークンを更新して 1 歩で戻されないようにする)。
  if (req.method === 'POST' && url.pathname === '/api/world/teleport') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_WORLD_TELEPORT }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { x?: number; y?: number };
    if (typeof body.x !== 'number' || typeof body.y !== 'number') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      return cors(json(await handleTeleport(env, did, body.x, body.y, nowSec(), nsFromOrigin(req))), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // フィールドの道具使用 (やくそう/そらのしずく)。サーバー在庫を消費して HP/MP を回復。
  if (req.method === 'POST' && url.pathname === '/api/world/item') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_WORLD_ITEM }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { item?: string };
    if (body.item !== 'herb' && body.item !== 'tonic') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      return cors(json(await handleItem(env, did, body.item, nowSec(), nsFromOrigin(req))), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // 装備ミラー: client が解決した GearSelection (強化値つき) を gameState に保存 (戦闘に反映)。
  if (req.method === 'POST' && url.pathname === '/api/world/gear') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_WORLD_GEAR }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { gear?: unknown };
    if (typeof body.gear !== 'object' || body.gear === null) return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      return cors(json(await handleGear(env, did, body.gear as Parameters<typeof handleGear>[2], nowSec(), nsFromOrigin(req))), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // しらべる: サーバーがアイテムを判定して gameState 在庫に付与 (client のみの幻を解消)。
  if (req.method === 'POST' && url.pathname === '/api/world/search') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_WORLD_SEARCH }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { token?: string };
    try {
      return cors(json(await handleSearch(env, did, typeof body.token === 'string' ? body.token : undefined, nowSec(), nsFromOrigin(req))), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // ── OAuth write 認証 (docs/21 §12) ──
  // confidential client メタデータ (公開)。
  if (req.method === 'GET' && url.pathname === '/client-metadata.json') {
    return cors(handleClientMetadata(env), allowedOrigin);
  }
  // 管理者が OAuth 連携を開始 (service auth JWT + ADMIN_DIDS)。authorizeUrl を返す。
  if (req.method === 'POST' && url.pathname === '/api/oauth/start') {
    return cors(await handleOAuthStart(req, env, { now: nowSec() }), allowedOrigin);
  }
  // 認可サーバーからのリダイレクト先。ブラウザ遷移なので HTML を直接返す (CORS 不要)。
  if (req.method === 'GET' && url.pathname === '/oauth/callback') {
    return handleOAuthCallback(req, env, { now: nowSec() });
  }

  return cors(json({ error: 'not_found', path: url.pathname }, 404), allowedOrigin);
}

/** 戦闘エラーを HTTP に振り分ける。**トークン切れ/未設定 (ServerWriteError) は 503 で fail-closed**
 *  (報酬は付かない・クライアント権威へのフォールバックは無い §3-6)。ResolverError はその status。 */
function battleError(e: unknown): Response {
  if (e instanceof ResolverError) return json({ error: e.code ?? 'battle_error', message: e.message }, e.status);
  if (e instanceof ServerWriteError) return json({ error: 'server_write_unavailable', reason: e.reason }, 503);
  // 失効/無効トークンで PDS が 401/403 を返した場合も **fail-closed 503** (報酬なし。500 で誤魔化さない)。
  if (e instanceof PdsError && (e.status === 401 || e.status === 403)) return json({ error: 'server_write_unavailable', reason: 'auth' }, 503);
  return json({ error: 'internal' }, 500);
}

/** Authorization: Bearer <jwt> を取り出す。 */
function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function cors(res: Response, allowedOrigin: string | null): Response {
  const headers = new Headers(res.headers);
  // 許可された origin のみ反射的に返す。Origin ヘッダなし (curl 等) は素通り。
  if (allowedOrigin) {
    headers.set('access-control-allow-origin', allowedOrigin);
    headers.set('vary', 'origin');
  }
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
  headers.set('access-control-allow-headers', 'authorization, content-type');
  return new Response(res.body, { status: res.status, headers });
}

declare global {
  // eslint-disable-next-line no-var
  var __COMMIT__: string | undefined;
}
