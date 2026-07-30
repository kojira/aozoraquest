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
import { handleClientMetadata, handleOAuthStart, handleOAuthStatus, handleOAuthCallback, type OAuthRoutesEnv } from './oauth-routes';
import { claimXp, adminSetJobXp, adminGrantPower, spendPower, XpClaimError } from './xp-claim';
import { shopCraft, shopSell, shopForge, shopDiscard, ShopError } from './shop';
import { handleMove, handleTurn, handleTeleport, handleItem, handleGear, handleSearch, handleReset, migrateInitState, playerLuk, ResolverError } from './battle-resolver';
import { signPosition, verifyPosition } from './world-token';
import { handleQuestAccept, handleQuestComplete, GameQuestError } from './game-quest';
import { ensureAuthoredWorld } from './world-authoring';
import { ServerWriteError } from './server-pds';
import { isEdgeAdmin } from './oauth-config';
import { readPdsUsage, opsRemaining, PUT_RECORD_POINTS } from './pds-usage';
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
const LXM_WORLD_RESET = 'app.aozoraquest.world.reset';
const LXM_BATTLE_TURN = 'app.aozoraquest.battle.turn';
const LXM_XP_CLAIM = 'app.aozoraquest.xp.claim';
const LXM_XP_ADMIN_SET = 'app.aozoraquest.xp.adminSet';
const LXM_POWER_ADMIN_GRANT = 'app.aozoraquest.power.adminGrant';
const LXM_SHOP_CRAFT = 'app.aozoraquest.shop.craft';
const LXM_SHOP_SELL = 'app.aozoraquest.shop.sell';
const LXM_SHOP_FORGE = 'app.aozoraquest.shop.forge';
const LXM_SHOP_DISCARD = 'app.aozoraquest.shop.discard';
const LXM_POWER_SPEND = 'app.aozoraquest.power.spend';
const LXM_ADMIN_PDS_USAGE = 'app.aozoraquest.admin.pdsUsage';
const LXM_QUEST_ACCEPT = 'app.aozoraquest.quest.accept';
const LXM_QUEST_COMPLETE = 'app.aozoraquest.quest.complete';

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
      // mapId (#424) も載せる — 内部マップに居るまま再読み込みしたとき、
      // 初手 move がフィールド判定になって壁にめり込むのを防ぐ。
      const token = signPosition(env, { did, ...(state.mapId ? { mapId: state.mapId } : {}), x: state.x, y: state.y, counter: 0, iat: nowSec() });
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
    const body = (await req.json().catch(() => ({}))) as { dx?: number; dy?: number; token?: string; battleId?: string; turn?: number; command?: string; skillIndex?: number };
    try {
      if (isTurn) {
        if (typeof body.battleId !== 'string' || typeof body.turn !== 'number' || typeof body.command !== 'string') {
          return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
        }
        const skillIndex = typeof body.skillIndex === 'number' ? body.skillIndex : 0; // とくぎ選択 (#436)。既定 0=署名
        // クエスト定義 (#423) の討伐カウントは勝利決着のこの経路で数える。コールド isolate だと
        // index.ts の waitUntil ロードが間に合わず「倒したのに数えられない」が無言で起きるので待つ
        // (ロード済みならキャッシュ即返し。設計レビュー ★★)。
        await ensureAuthoredWorld(env, nsFromOrigin(req), nowSec());
        return cors(json(await handleTurn(env, did, body.battleId, body.turn, body.command as Command, nowSec(), nsFromOrigin(req), skillIndex)), allowedOrigin);
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
    const body = (await req.json().catch(() => ({}))) as { token?: string; key?: unknown };
    try {
      return cors(json(await handleSearch(env, did, typeof body.token === 'string' ? body.token : undefined, nowSec(), nsFromOrigin(req), undefined,
        typeof body.key === 'string' && body.key.length <= 128 ? body.key : undefined)), allowedOrigin);
    } catch (e) {
      return cors(battleError(e), allowedOrigin);
    }
  }

  // XP 申告: 投稿・クエストの XP を権威 state の jobXp に積む (#534)。
  // 種類ごとの上限クランプ + 冪等キーで、client 由来でも青天井にならないようにする。
  if (req.method === 'POST' && url.pathname === '/api/xp/claim') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_XP_CLAIM }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    // **額は client が送らない** — サーバーが決める (2026-07-27)。送るのは投稿の URI だけ。
    const body = (await req.json().catch(() => ({}))) as { archetype?: unknown; postUri?: unknown };
    if (typeof body.archetype !== 'string' || typeof body.postUri !== 'string') {
      return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    }
    try {
      // **init を必ず渡す** — 省略すると emptyState で権威 state が新規作成され、
      // ユーザー PDS のパワー残高・冒険はじめの持ち物・開始位置が取り込まれないまま固定される
      // (以後 readState が null を返さないので migrateInitState は二度と走らない)。
      // 「世界を開く前にホームから投稿する」だけで踏む経路なので致命的。
      const ns = nsFromOrigin(req);
      const result = await claimXp(env, did, { archetype: body.archetype, postUri: body.postUri }, nowSec(),
        (d, iso) => migrateInitState(d, iso, ns));
      return cors(json(result), allowedOrigin);
    } catch (e) {
      if (e instanceof XpClaimError) return cors(json({ error: 'bad_request', reason: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // 管理者がジョブ Lv を直接セットする (#534)。XP を権威 state に一本化したので、
  // analysis を書き換える従来の管理ツールではレベルが動かせない。Lv30 パッシブ等の
  // 実プレイ確認に必要なので、**ADMIN_DIDS ゲート付き**で権威側に用意する。
  if (req.method === 'POST' && url.pathname === '/api/xp/admin-set') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_XP_ADMIN_SET }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    if (!isEdgeAdmin(env, did)) return cors(json({ error: 'forbidden' }, 403), allowedOrigin);
    const body = (await req.json().catch(() => ({}))) as { archetype?: unknown; level?: unknown };
    if (typeof body.archetype !== 'string' || typeof body.level !== 'number') {
      return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    }
    // 対象は自分のみ (他人の state は動かせない)。管理でも他人のデータは触らせない。
    try {
      const ns = nsFromOrigin(req);
      const r = await adminSetJobXp(env, did, body.archetype, body.level, nowSec(), (d, iso) => migrateInitState(d, iso, ns));
      return cors(json(r), allowedOrigin);
    } catch (e) {
      if (e instanceof XpClaimError) return cors(json({ error: 'bad_request', reason: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // 管理者が PDS の書き込みレート消費を見る (#548)。**PDS 分割の潮時を判断するため**。
  // 権威 state は全ユーザーが 1 つのサーバーアカウント repo を共有しており、
  // Bluesky の上限は DID ごと 5,000 points/時・35,000 points/日、putRecord は 2 points。
  // = 全ユーザー合計で 1 時間 2,500 操作 / 1 日 17,500 操作が天井。
  if (req.method === 'GET' && url.pathname === '/api/admin/pds-usage') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_ADMIN_PDS_USAGE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    if (!isEdgeAdmin(env, did)) return cors(json({ error: 'forbidden' }, 403), allowedOrigin);
    const usage = await readPdsUsage(env.OAUTH_TOKENS);
    return cors(json({ usage, opsRemaining: opsRemaining(usage), pointsPerOp: PUT_RECORD_POINTS }), allowedOrigin);
  }

  // パワーの消費 (カードの引き直しなど)。**値段はサーバーが決める** — client が金額を送らない。
  if (req.method === 'POST' && url.pathname === '/api/power/spend') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_POWER_SPEND }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown; key?: unknown };
    if (body.reason !== 'card-draw' || typeof body.key !== 'string') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      return cors(json(await spendPower(env, did, { reason: body.reason, key: body.key }, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof XpClaimError) return cors(json({ error: 'bad_request', reason: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // 管理者があおぞらパワーを権威 state に付与する。管理画面のパワー付与は client 側の
  // PDS レコードしか書いておらず、報酬の可否を決める GameState.power は 0 のままだった
  // (= 画面にはパワーがあるのに勝っても報酬が出ない)。
  if (req.method === 'POST' && url.pathname === '/api/power/admin-grant') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_POWER_ADMIN_GRANT }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    if (!isEdgeAdmin(env, did)) return cors(json({ error: 'forbidden' }, 403), allowedOrigin);
    const body = (await req.json().catch(() => ({}))) as { amount?: unknown };
    if (typeof body.amount !== 'number') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      return cors(json(await adminGrantPower(env, did, body.amount, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof XpClaimError) return cors(json({ error: 'bad_request', reason: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // なんでも屋: 装備を作ってもらう。**費用 (パワー + 素材) を権威側から引く** (#551)。
  // 品揃えも値段も強化値もサーバーが決める — client が送ってきた値段を信じない。
  if (req.method === 'POST' && url.pathname === '/api/shop/craft') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_SHOP_CRAFT }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { itemId?: unknown; rkey?: unknown; token?: unknown };
    if (typeof body.itemId !== 'string' || typeof body.rkey !== 'string') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      const pos = positionFrom(env, body.token, did);
      // 強化値の抽選に効く luk はサーバーが出す (client 申告を使わない)。
      const luk = await playerLuk(env, did, ns);
      return cors(json(await shopCraft(env, did, { itemId: body.itemId, rkey: body.rkey, luk, ...(pos ? { pos } : {}) }, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof ShopError) return cors(json({ error: e.code ?? 'shop_error', message: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // なんでも屋: きたえる (同じ品・同じ強化値の 2 個体 → +1)。消費する個体は権威側から探す。
  if (req.method === 'POST' && url.pathname === '/api/shop/forge') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_SHOP_FORGE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { rkeys?: unknown; rkey?: unknown; token?: unknown };
    const pair = Array.isArray(body.rkeys) && body.rkeys.length === 2 && body.rkeys.every((v) => typeof v === 'string')
      ? (body.rkeys as [string, string]) : null;
    if (!pair || typeof body.rkey !== 'string') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      const pos = positionFrom(env, body.token, did);
      return cors(json(await shopForge(env, did, { rkeys: pair, rkey: body.rkey, ...(pos ? { pos } : {}) }, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof ShopError) return cors(json({ error: e.code ?? 'shop_error', message: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // もちもの: 装備を すてる (#575)。**街の外でもできる** — 上限に達すると制作も購入も
  // 断られるので、街に着くまで整理できないと詰む。パワーは返さない。
  if (req.method === 'POST' && url.pathname === '/api/shop/discard') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_SHOP_DISCARD }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { rkeys?: unknown; rkey?: unknown };
    const rkeys = Array.isArray(body.rkeys) && body.rkeys.length > 0 && body.rkeys.every((v) => typeof v === 'string')
      ? (body.rkeys as string[]) : null;
    if (!rkeys || typeof body.rkey !== 'string') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      return cors(json(await shopDiscard(env, did, { rkeys, rkey: body.rkey }, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof ShopError) return cors(json({ error: e.code ?? 'shop_error', message: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // ゲーム内クエスト (#423): 受注 / 達成。**条件検証も報酬付与も権威側** — 討伐数は勝利時に
  // battle-reward が数え、素材は権威在庫を見て引き取り、パワーは定義の値だけ足す。
  if (req.method === 'POST' && (url.pathname === '/api/quest/accept' || url.pathname === '/api/quest/complete')) {
    const accept = url.pathname === '/api/quest/accept';
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: accept ? LXM_QUEST_ACCEPT : LXM_QUEST_COMPLETE }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { questId?: unknown };
    if (typeof body.questId !== 'string') return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    try {
      const ns = nsFromOrigin(req);
      // コールドスタート直後だと定義が未ロードで「そのクエストは無い」に落ちるので、ここは待つ
      // (TTL 内はキャッシュ即返しでコスト無し)。
      await ensureAuthoredWorld(env, ns, nowSec());
      const handler = accept ? handleQuestAccept : handleQuestComplete;
      return cors(json(await handler(env, did, body.questId, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof GameQuestError) return cors(json({ error: e.code ?? 'quest_error', message: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // なんでも屋: 素材のひきとり (素材 → パワー)。権威側の在庫と残高を動かす。
  if (req.method === 'POST' && url.pathname === '/api/shop/sell') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_SHOP_SELL }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    const body = (await req.json().catch(() => ({}))) as { materialId?: unknown; count?: unknown; rkey?: unknown; token?: unknown };
    if (typeof body.materialId !== 'string' || typeof body.count !== 'number' || typeof body.rkey !== 'string') {
      return cors(json({ error: 'bad_request' }, 400), allowedOrigin);
    }
    try {
      const ns = nsFromOrigin(req);
      const pos = positionFrom(env, body.token, did);
      return cors(json(await shopSell(env, did, { materialId: body.materialId, count: body.count, rkey: body.rkey, ...(pos ? { pos } : {}) }, nowSec(), (d, iso) => migrateInitState(d, iso, ns))), allowedOrigin);
    } catch (e) {
      if (e instanceof ShopError) return cors(json({ error: e.code ?? 'shop_error', message: e.message }, e.status), allowedOrigin);
      return cors(battleError(e), allowedOrigin);
    }
  }

  // オンボード用リセット: 認証済み本人の権威 gameState + 戦闘ガードを削除する (他人は消せない)。
  // client 側 PDS レコードの初期化は client が本人トークンで行う。UI は dev + 管理者に限定。
  if (req.method === 'POST' && url.pathname === '/api/world/reset') {
    const token = bearer(req);
    if (!token) return cors(json({ error: 'missing_token' }, 401), allowedOrigin);
    const audience = env.WORKER_DID ?? 'did:web:edge.aozoraquest.app';
    let did: string;
    try {
      ({ iss: did } = await verifyServiceAuth(token, { audience, lxm: LXM_WORLD_RESET }));
    } catch (e) {
      return cors(json({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401), allowedOrigin);
    }
    try {
      return cors(json(await handleReset(env, did, nowSec())), allowedOrigin);
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
  // 管理者が連携状態を確認 (トークン本体は返さない)。設定画面の表示用。
  if (req.method === 'GET' && url.pathname === '/api/oauth/status') {
    return cors(await handleOAuthStatus(req, env, { now: nowSec() }), allowedOrigin);
  }
  // 認可サーバーからのリダイレクト先。ブラウザ遷移なので HTML を直接返す (CORS 不要)。
  if (req.method === 'GET' && url.pathname === '/oauth/callback') {
    return handleOAuthCallback(req, env, { now: nowSec() });
  }

  return cors(json({ error: 'not_found', path: url.pathname }, 404), allowedOrigin);
}

/** 戦闘エラーを HTTP に振り分ける。**トークン切れ/未設定 (ServerWriteError) は 503 で fail-closed**
 *  (報酬は付かない・クライアント権威へのフォールバックは無い §3-6)。ResolverError はその status。 */
/** 署名済み位置トークンから座標を取り出す。無い/無効なら undefined (state に倒す)。 */
function positionFrom(env: Env, token: unknown, did: string): { x: number; y: number } | undefined {
  if (typeof token !== 'string' || !token) return undefined;
  try {
    const c = verifyPosition(env, token, did, nowSec());
    return { x: c.x, y: c.y };
  } catch {
    return undefined;
  }
}

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
