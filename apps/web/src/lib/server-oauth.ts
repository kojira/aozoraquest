/**
 * サーバーアカウントの OAuth 連携を管理者が開始する導線 — docs/21 §12。
 *
 * 管理者がログイン中に、自分の OAuth セッション (Agent) で **service auth JWT** (aud=edge Worker,
 * lxm=oauth.start) を発行 → edge の `/api/oauth/start` に渡すと、edge が PAR して authorize URL を
 * 返す。そこへリダイレクトし、サーバーアカウントで 1 回ログインすると edge がトークンを保管する。
 */
import type { Agent } from '@atproto/api';
// world-server と**同じエッジ**を叩く (連携先とワールド呼び出し先がズレる不具合を防ぐ。#396)。
import { EDGE_URL, EDGE_DID } from './edge-config';

const LXM_OAUTH_START = 'app.aozoraquest.oauth.start';
const LXM_OAUTH_STATUS = 'app.aozoraquest.oauth.status';

/** edge URL / DID が設定されていれば連携導線を出せる。 */
export const serverOAuthConfigured = Boolean(EDGE_URL && EDGE_DID);

/** サーバーアカウント連携の状態 (トークン本体は含まない)。 */
export interface ServerOAuthStatus {
  linked: boolean;
  did?: string;
  pdsUrl?: string;
  /** access token 失効時刻 (epoch 秒)。 */
  expiresAt?: number;
  /** 最終更新 (epoch 秒。cron refresh でも更新)。 */
  updatedAt?: number;
}

/** サーバーアカウント連携の状態を取得 (設定画面の表示用)。管理者のみ (edge が ADMIN_DIDS 検証)。 */
export async function getServerOAuthStatus(agent: Agent): Promise<ServerOAuthStatus> {
  if (!EDGE_URL || !EDGE_DID) throw new Error('VITE_EDGE_URL / VITE_EDGE_DID が未設定です');
  const { data } = await agent.com.atproto.server.getServiceAuth({ aud: EDGE_DID, lxm: LXM_OAUTH_STATUS });
  const res = await fetch(`${EDGE_URL}/api/oauth/status`, { headers: { authorization: `Bearer ${data.token}` } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const detail = [body.error, body.message].filter(Boolean).join(' ').trim();
    throw new Error(`状態取得に失敗しました (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as ServerOAuthStatus;
}

/** サーバーアカウント OAuth 連携を開始し、認可 URL へ遷移する。失敗時は Error を throw。 */
export async function startServerOAuth(agent: Agent): Promise<void> {
  if (!EDGE_URL || !EDGE_DID) throw new Error('VITE_EDGE_URL / VITE_EDGE_DID が未設定です');
  // 管理者本人の署名で service auth JWT を発行 (edge が aud/lxm と ADMIN_DIDS を検証)。
  const { data } = await agent.com.atproto.server.getServiceAuth({ aud: EDGE_DID, lxm: LXM_OAUTH_START });
  const res = await fetch(`${EDGE_URL}/api/oauth/start`, {
    method: 'POST',
    headers: { authorization: `Bearer ${data.token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    const detail = [body.error, body.message].filter(Boolean).join(' ').trim();
    throw new Error(`連携開始に失敗しました (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  if (!authorizeUrl) throw new Error('authorizeUrl が返りませんでした');
  window.location.href = authorizeUrl; // 認可サーバーへ遷移
}
