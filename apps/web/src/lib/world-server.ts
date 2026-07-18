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
const LXM_TURN = 'app.aozoraquest.battle.turn';

/** edge URL / DID が設定されていればサーバー権威モードを使える。 */
export const worldServerEnabled = Boolean(EDGE_URL && EDGE_DID);

/** サーバー権威エンドポイントのエラー (status 付き。503=書込不能で報酬なし fail-closed 等)。 */
export class WorldServerError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

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
  const res = await fetch(`${EDGE_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string; reason?: string };
  if (!res.ok) {
    throw new WorldServerError(data.message ?? data.reason ?? data.error ?? `edge ${res.status}`, res.status, data.error);
  }
  return data as T;
}

// ── DTO (edge の返り値。seed は含まれない = 先読み不可) ──
export interface ServerMonster { name: string; maxHp: number; hp: number; maxMp: number; mp: number; [k: string]: unknown }
export interface ServerBattleState { player: ServerMonster; monster: ServerMonster; monsterId: string; outcome: string; turn: number; lastEvents: { actor: string; text: string }[]; [k: string]: unknown }
export interface ServerEncounter { battleId: string; monsterId: string; state: ServerBattleState; rewarded: boolean }
export interface ServerMoveResult { x: number; y: number; terrain: string; encounter?: ServerEncounter }
export interface ServerAward { xp?: number; drops?: string[]; materialsLost?: string[]; powerSpent?: number }
export interface ServerTurnResult { state: ServerBattleState; events: { actor: string; text: string }[]; outcome: string; awarded?: ServerAward }

/** 移動: 隣接1マス (dx,dy ∈ {-1,0,1})。位置更新 + 遭遇判定はサーバー。 */
export function serverMove(agent: Agent, dx: number, dy: number): Promise<ServerMoveResult> {
  return callEdge<ServerMoveResult>(agent, LXM_MOVE, '/api/world/move', { dx, dy });
}

/** 攻撃 (1ターン): battleId + turn + command。解決 + 決着報酬はサーバー。 */
export function serverTurn(agent: Agent, battleId: string, turn: number, command: string): Promise<ServerTurnResult> {
  return callEdge<ServerTurnResult>(agent, LXM_TURN, '/api/battle/turn', { battleId, turn, command });
}
