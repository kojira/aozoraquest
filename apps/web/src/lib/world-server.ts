/**
 * あおぞらワールドのサーバー権威 API クライアント — docs/21 §5。
 *
 * **移動も攻撃も毎回 edge Worker が権威処理する**ためのクライアント側呼び出し。ユーザー自身の
 * service auth JWT (aud=edge Worker) を発行して edge に渡す。edge が本人確認 → 権威 state を読み書き
 * → 結果を返す。**クライアントは結果を描画するだけで、権威データ (パワー/XP/素材/位置) を自分の PDS
 * に書かない** = 改造してもチートできない。
 */
import type { Agent } from '@atproto/api';

const EDGE_URL = (import.meta.env.VITE_EDGE_URL as string | undefined)?.trim();
const EDGE_DID = (import.meta.env.VITE_EDGE_DID as string | undefined)?.trim();

const LXM_MOVE = 'app.aozoraquest.world.move';
const LXM_TELEPORT = 'app.aozoraquest.world.teleport';
const LXM_ITEM = 'app.aozoraquest.world.item';
const LXM_GEAR = 'app.aozoraquest.world.gear';
const LXM_TURN = 'app.aozoraquest.battle.turn';
const LXM_STATE = 'app.aozoraquest.me.state';

/** edge URL / DID が設定されていればサーバー権威モードを使える。 */
export const worldServerEnabled = Boolean(EDGE_URL && EDGE_DID);

/** サーバー権威エンドポイントのエラー (status 付き。503=書込不能で報酬なし fail-closed 等)。 */
export class WorldServerError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** edge への 1 リクエストのタイムアウト (ms)。応答が返らずハングしても busy が永久固着しないよう、
 *  必ず fail-closed で throw させる (通信断/無応答でも報酬は付かない・クライアント権威にフォールバックしない)。 */
const EDGE_TIMEOUT_MS = 8000;

/** service auth JWT を lxm ごとにキャッシュ (毎アクション PDS 往復を避ける。exp 30s 前まで再利用)。 */
const tokenCache = new Map<string, { token: string; exp: number }>();

async function serviceToken(agent: Agent, lxm: string): Promise<string> {
  const nowSec = Date.now() / 1000;
  const cached = tokenCache.get(lxm);
  if (cached && cached.exp - 30 > nowSec) return cached.token;
  const { data } = await agent.com.atproto.server.getServiceAuth({ aud: EDGE_DID!, lxm });
  let exp = nowSec + 60;
  try {
    exp = (JSON.parse(atob(data.token.split('.')[1]!)) as { exp?: number }).exp ?? exp;
  } catch { /* exp 取れなければ 60s 後 */ }
  tokenCache.set(lxm, { token: data.token, exp });
  return data.token;
}

async function callEdge<T>(agent: Agent, lxm: string, path: string, body: unknown): Promise<T> {
  if (!EDGE_URL || !EDGE_DID) throw new WorldServerError('サーバー権威 API 未設定', 0, 'not_configured');
  const token = await serviceToken(agent, lxm);
  let res: Response;
  try {
    res = await fetch(`${EDGE_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EDGE_TIMEOUT_MS),
    });
  } catch (e) {
    // タイムアウト/通信断 = fail-closed (報酬なし)。status 0 で catch 側が busy を必ず解除できるようにする。
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new WorldServerError(timedOut ? 'サーバーが応答しません' : '通信に失敗しました', 0, timedOut ? 'timeout' : 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; reason?: string };
  if (!res.ok) {
    if (res.status === 401) tokenCache.delete(lxm); // 失効トークンを捨てて次アクションで再取得 (401 ループ回避)
    throw new WorldServerError(data.message ?? data.reason ?? data.error ?? `edge ${res.status}`, res.status, data.error);
  }
  return data as T;
}

// ── DTO (edge の返り値。seed は含まれない = 先読み不可) ──
export interface ServerMonster { name: string; maxHp: number; hp: number; maxMp: number; mp: number; [k: string]: unknown }
export interface ServerBattleState { player: ServerMonster; monster: ServerMonster; monsterId: string; outcome: string; turn: number; lastEvents: { actor: string; text: string }[]; [k: string]: unknown }
export interface ServerEncounter { battleId: string; monsterId: string; state: ServerBattleState; rewarded: boolean }
export interface ServerMoveResult { x: number; y: number; terrain: string; healed?: boolean; token: string; encounter?: ServerEncounter }
/** 権威 GameState (パワー/XP/素材/位置/carry HP-MP 等)。表示はこれを正とする。 */
export interface ServerGameState { did: string; power: number; playerXp: number; jobXp: Record<string, number>; materials: Record<string, number>; gear: string[]; x: number; y: number; carryHp?: number; carryMp?: number; herbs?: number; tonics?: number; version: number; updatedAt: string }
export interface ServerStateResult { state: ServerGameState; initialized: boolean; token?: string }
export interface ServerAward { xp?: number; drops?: string[]; materialsLost?: string[]; powerSpent?: number }
export interface ServerTurnResult { state: ServerBattleState; events: { actor: string; text: string }[]; outcome: string; awarded?: ServerAward; position?: { x: number; y: number }; token?: string; materials?: Record<string, number>; carryHp?: number; carryMp?: number }
export interface ServerItemResult { carryHp?: number; carryMp?: number; materials: Record<string, number>; healed: number }
export interface ServerTeleportResult { x: number; y: number; token: string; materials: Record<string, number> }

/** 移動: 隣接1マス (dx,dy ∈ {-1,0,1})。位置トークン (署名済み) を渡し、遭遇判定 + 新トークンをサーバーが返す。
 *  token 未指定 (初回) はサーバーが gameState から位置を再同期する。歩行では PDS を触らないので高速。 */
export function serverMove(agent: Agent, dx: number, dy: number, token?: string): Promise<ServerMoveResult> {
  return callEdge<ServerMoveResult>(agent, LXM_MOVE, '/api/world/move', token ? { dx, dy, token } : { dx, dy });
}

/** 攻撃 (1ターン): battleId + turn + command。解決 + 決着報酬はサーバー。 */
export function serverTurn(agent: Agent, battleId: string, turn: number, command: string): Promise<ServerTurnResult> {
  return callEdge<ServerTurnResult>(agent, LXM_TURN, '/api/battle/turn', { battleId, turn, command });
}

/** そらのはねワープ: 街 (x,y) へテレポート。位置・トークン・在庫 (そらのはね消費) をサーバーが返す。 */
export function serverTeleport(agent: Agent, x: number, y: number): Promise<ServerTeleportResult> {
  return callEdge<ServerTeleportResult>(agent, LXM_TELEPORT, '/api/world/teleport', { x, y });
}

/** フィールドの道具使用: やくそう=herb / そらのしずく=tonic。サーバー在庫を消費して HP/MP を回復。 */
export function serverItem(agent: Agent, item: 'herb' | 'tonic'): Promise<ServerItemResult> {
  return callEdge<ServerItemResult>(agent, LXM_ITEM, '/api/world/item', { item });
}

/** 装備ミラー: client が解決した装備 (GearSelection: 強化値つき) をサーバーへ送り、戦闘に反映させる (#377)。 */
export function serverGear(agent: Agent, gear: unknown): Promise<{ ok: true }> {
  return callEdge<{ ok: true }>(agent, LXM_GEAR, '/api/world/gear', { gear });
}

/** 権威 GameState を読む (表示用: パワー/XP/素材/位置)。GET だが lxm 付き JWT で本人確認。 */
export async function serverState(agent: Agent): Promise<ServerStateResult> {
  if (!EDGE_URL || !EDGE_DID) throw new WorldServerError('サーバー権威 API 未設定', 0, 'not_configured');
  const token = await serviceToken(agent, LXM_STATE);
  let res: Response;
  try {
    res = await fetch(`${EDGE_URL}/api/me/state`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(EDGE_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new WorldServerError(timedOut ? 'サーバーが応答しません' : '通信に失敗しました', 0, timedOut ? 'timeout' : 'network');
  }
  const data = (await res.json().catch(() => ({}))) as ServerStateResult & { error?: string };
  if (!res.ok) {
    if (res.status === 401) tokenCache.delete(LXM_STATE);
    throw new WorldServerError(data.error ?? `edge ${res.status}`, res.status, data.error);
  }
  return data;
}
