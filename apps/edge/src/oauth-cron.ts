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

/** 期限の何秒前から refresh するか。Cron 間隔より大きくして「1 tick 失敗しても次 tick で再試行」の
 *  余裕を残す。二重 refresh の抑止は refreshingUntil ソフトロックで別途行う。 */
export const REFRESH_AHEAD_SEC = 900;
/** refresh 進行中ソフトロックの保持時間 (秒)。この間は他 tick が refresh を控える。 */
export const REFRESH_LOCK_SEC = 120;

export interface CronEnv extends OAuthEnv {
  OAUTH_TOKENS?: KVNamespace;
}

export type CronStatus = 'refreshed' | 'not-due' | 'refreshing' | 'not-bootstrapped' | 'no-kv' | 'not-configured' | 'error';

/**
 * cron 1 回分の refresh 処理。副作用は KV 書き込みのみ。結果を返す (ログ/監視用)。
 *
 * **二重 refresh の抑止**: Cloudflare の cron は tick が重なりうる (遅い refresh が次 tick に追いつく) ため、
 * refresh 前に `refreshingUntil` マーカーを書き、他 tick はそれを見て控える (ソフトロック)。KV に CAS が
 * 無いので厳密ではない (同時 tick は稀に競合しうる) が、ロックアウトは再 OAuth で復旧できる。
 */
export async function runCronRefresh(env: CronEnv, now: number, fetchImpl?: typeof fetch): Promise<{ status: CronStatus; detail?: string }> {
  if (!env.OAUTH_TOKENS) return { status: 'no-kv' };
  const tokens = await readServerTokens(env.OAUTH_TOKENS);
  if (!tokens) return { status: 'not-bootstrapped' };
  if (now < tokens.expiresAt - REFRESH_AHEAD_SEC) return { status: 'not-due' };
  // 別 tick が refresh 中ならスキップ (ローテーション競合 = ロックアウト回避)。
  if (tokens.refreshingUntil && now < tokens.refreshingUntil) return { status: 'refreshing' };

  let cfg;
  try {
    cfg = loadOAuthConfig(env);
  } catch (e) {
    if (e instanceof OAuthConfigError) return { status: 'not-configured', detail: e.message };
    throw e;
  }
  // 先にマーカーを立ててから refresh (他 tick に「進行中」を知らせる)。
  await writeServerTokens(env.OAUTH_TOKENS, { ...tokens, refreshingUntil: now + REFRESH_LOCK_SEC });
  try {
    const { pdsUrl, authServer } = await discoverForDid(cfg.serverDid, fetchImpl);
    const next = await refreshTokens({ ...cfg, now, fetchImpl }, authServer, tokens.refreshToken, pdsUrl, cfg.serverDid);
    await writeServerTokens(env.OAUTH_TOKENS, next); // refreshingUntil は載せない = ロック解除
    return { status: 'refreshed' };
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}
