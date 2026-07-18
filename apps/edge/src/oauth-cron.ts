/**
 * OAuth トークンの cron refresher — docs/21 §12。
 *
 * **唯一の refresh 実行者**。Cron Trigger から定期起動し、access token 失効前に refresh_token で
 * 更新して KV に書き戻す。リクエスト処理 Worker は refresh しない (書き手を 1 つに直列化し、
 * refresh token ローテーションのレース = ロックアウトを防ぐ)。
 *
 * refresh 失敗 (invalid_grant = refresh token 失効) はロックアウトで、管理画面から再 OAuth が要る。
 * その場合もトークンは残し (診断用)、書き込み経路は fail-closed に倒す。
 */
import { loadOAuthConfig, OAuthConfigError, type OAuthEnv } from './oauth-config';
import { discoverForDid } from './oauth-metadata';
import { refreshTokens } from './oauth-client';
import { readServerTokens, writeServerTokens } from './oauth-store';

/** 期限の何秒前から refresh するか。Cron 間隔 (<10 分) より十分大きくして取りこぼしを防ぐ。 */
export const REFRESH_AHEAD_SEC = 900;

export interface CronEnv extends OAuthEnv {
  OAUTH_TOKENS?: KVNamespace;
}

export type CronStatus = 'refreshed' | 'not-due' | 'not-bootstrapped' | 'no-kv' | 'not-configured' | 'error';

/** cron 1 回分の refresh 処理。副作用は KV 書き込みのみ。結果を返す (ログ/監視用)。 */
export async function runCronRefresh(env: CronEnv, now: number, fetchImpl?: typeof fetch): Promise<{ status: CronStatus; detail?: string }> {
  if (!env.OAUTH_TOKENS) return { status: 'no-kv' };
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) return { status: 'not-bootstrapped' };
  if (now < tokens.expiresAt - REFRESH_AHEAD_SEC) return { status: 'not-due' };

  let cfg;
  try {
    cfg = loadOAuthConfig(env);
  } catch (e) {
    if (e instanceof OAuthConfigError) return { status: 'not-configured', detail: e.message };
    throw e;
  }
  try {
    const { authServer } = await discoverForDid(cfg.serverDid, fetchImpl);
    const next = await refreshTokens({ ...cfg, now, fetchImpl }, authServer, tokens.refreshToken, cfg.serverDid);
    // PDS 用 DPoP-Nonce は保持 (認可サーバーの nonce とは別物)。
    await writeServerTokens(env.OAUTH_TOKENS, { ...next, dpopNonce: tokens.dpopNonce });
    return { status: 'refreshed' };
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}
