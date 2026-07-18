/**
 * OAuth confidential client の設定を Worker env から組み立てる — docs/21 §12。
 *
 * 秘密鍵 (client 署名鍵 / DPoP 鍵) は Worker Secret に JWK(JSON) で入れる。client_id / redirect_uri は
 * edge の公開 origin から導出。管理者判定 (ADMIN_DIDS) は /oauth/start のゲートに使う。
 * サーバーアカウント (kojira.io) の DID は SERVER_DID (Variable)。**ソースに直書きしない**。
 */
import { publicJwk, type EcJwk } from './oauth-jwt';

export interface OAuthEnv {
  /** client 署名鍵 (private_key_jwt)。Secret。JWK JSON。 */
  OAUTH_CLIENT_PRIVATE_JWK?: string;
  /** DPoP 鍵。Secret。JWK JSON。 */
  OAUTH_DPOP_PRIVATE_JWK?: string;
  /** サーバーアカウント DID (権威データの持ち主 = kojira.io)。Variable。 */
  SERVER_DID?: string;
  /** 管理者 DID 許可リスト (カンマ区切り)。/oauth/start ゲート用。Variable。 */
  ADMIN_DIDS?: string;
  /** この Worker の DID (did:web:edge.aozoraquest.app 等)。origin 導出に使う。 */
  WORKER_DID?: string;
  /** 公開 origin の明示指定 (WORKER_DID から導出できない場合)。 */
  PUBLIC_ORIGIN?: string;
  /** OAuth scope。既定 'atproto transition:generic'。 */
  OAUTH_SCOPE?: string;
}

export class OAuthConfigError extends Error {}

/** edge の公開 origin (client_id / redirect_uri のベース)。 */
export function publicOrigin(env: OAuthEnv): string {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const wd = env.WORKER_DID;
  if (wd?.startsWith('did:web:')) return `https://${wd.slice('did:web:'.length).split(':')[0]}`;
  throw new OAuthConfigError('PUBLIC_ORIGIN も WORKER_DID(did:web) も無い');
}

function parseJwk(raw: string | undefined, name: string): EcJwk {
  if (!raw) throw new OAuthConfigError(`${name} が未設定`);
  let j: EcJwk;
  try {
    j = JSON.parse(raw) as EcJwk;
  } catch {
    throw new OAuthConfigError(`${name} が JSON として不正`);
  }
  if (j.kty !== 'EC' || j.crv !== 'P-256' || !j.d) throw new OAuthConfigError(`${name} は P-256 秘密鍵 JWK である必要がある`);
  return j;
}

export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  clientJwk: EcJwk;
  dpopJwk: EcJwk;
  serverDid: string;
  publicOrigin: string;
}

/** env から設定を読む。秘密鍵の未設定/不正・SERVER_DID 欠落は OAuthConfigError (fail-closed)。 */
export function loadOAuthConfig(env: OAuthEnv): OAuthConfig {
  const origin = publicOrigin(env);
  if (!env.SERVER_DID) throw new OAuthConfigError('SERVER_DID が未設定');
  return {
    clientId: `${origin}/client-metadata.json`,
    redirectUri: `${origin}/oauth/callback`,
    scope: env.OAUTH_SCOPE ?? 'atproto transition:generic',
    clientJwk: parseJwk(env.OAUTH_CLIENT_PRIVATE_JWK, 'OAUTH_CLIENT_PRIVATE_JWK'),
    dpopJwk: parseJwk(env.OAUTH_DPOP_PRIVATE_JWK, 'OAUTH_DPOP_PRIVATE_JWK'),
    serverDid: env.SERVER_DID,
    publicOrigin: origin,
  };
}

/** 呼び出し元 DID が edge の管理者許可リストに含まれるか (/oauth/start ゲート)。 */
export function isEdgeAdmin(env: OAuthEnv, did: string): boolean {
  return (env.ADMIN_DIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(did);
}

/** AT Proto confidential client のメタデータ (GET /client-metadata.json で返す)。 */
export function buildClientMetadata(cfg: OAuthConfig): Record<string, unknown> {
  return {
    client_id: cfg.clientId,
    client_name: 'aozoraquest',
    client_uri: 'https://aozoraquest.app',
    redirect_uris: [cfg.redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: cfg.scope,
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'ES256',
    dpop_bound_access_tokens: true,
    application_type: 'web',
    jwks: { keys: [{ ...publicJwk(cfg.clientJwk), kid: cfg.clientJwk.kid, use: 'sig', alg: 'ES256' }] },
  };
}
