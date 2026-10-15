/**
 * OAuth (AT Protocol) 用の ES256 JWT 署名ユーティリティ — docs/21 §12。
 *
 * サーバーアカウントの書き込み認証を OAuth confidential client + DPoP で行うため、以下を署名する:
 *   - **DPoP proof** (`typ: dpop+jwt`): 全トークン/PDS リクエストに付ける sender-constrained 証明。
 *   - **client assertion** (`private_key_jwt`): confidential client のクライアント認証。
 *
 * 署名は `@noble/curves` p256 (ES256)、base64url は `@scure/base` — service-auth.ts の検証側と同じ道具
 * (重い OAuth ライブラリを足さない = supply-chain cooldown も避ける)。鍵は EC P-256 の JWK。
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base64urlnopad } from '@scure/base';

/** EC P-256 の JWK。`d` があれば秘密鍵 (署名可)、無ければ公開鍵。 */
export interface EcJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d?: string;
  kid?: string;
}

const enc = new TextEncoder();
const b64uJson = (o: unknown): string => base64urlnopad.encode(enc.encode(JSON.stringify(o)));
const b64uStr = (s: string): string => base64urlnopad.encode(enc.encode(s));

/** JWK から公開部分だけ取り出す (d と kid を除く。DPoP ヘッダの jwk 用)。 */
export function publicJwk(jwk: EcJwk): EcJwk {
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/** RFC 7638 JWK thumbprint (EC は crv,kty,x,y を辞書順で正規化 → sha256 → base64url)。 */
export function jwkThumbprint(jwk: EcJwk): string {
  const canon = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  return base64urlnopad.encode(sha256(enc.encode(canon)));
}

/** ES256 で JWT を署名する。`header`/`payload` は任意オブジェクト。 */
export function signEs256(header: Record<string, unknown>, payload: Record<string, unknown>, jwk: EcJwk): string {
  if (!jwk.d) throw new Error('signEs256: 秘密鍵 (d) が無い JWK では署名できない');
  const signingInput = `${b64uJson(header)}.${b64uJson(payload)}`;
  const d = base64urlnopad.decode(jwk.d);
  // 検証側 (service-auth) と対称: sha256(signingInput) を prehash として渡し、low-S を強制。
  const sig = p256.sign(sha256(enc.encode(signingInput)), d, { lowS: true });
  return `${signingInput}.${base64urlnopad.encode(sig.toCompactRawBytes())}`;
}

/** access token の DPoP `ath` クレーム (base64url(sha256(token)))。 */
export function accessTokenHash(accessToken: string): string {
  return base64urlnopad.encode(sha256(enc.encode(accessToken)));
}

/** ランダムな jti (16 バイト CSPRNG → base64url)。 */
export function randomJti(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return base64urlnopad.encode(b);
}

/**
 * DPoP proof JWT を作る (RFC 9449)。`htm`=HTTP メソッド, `htu`=URL (クエリ/フラグメント除去)。
 * サーバーから `DPoP-Nonce` を要求されたら `nonce` を入れて作り直す。access token に紐づける
 * リクエストでは `accessToken` を渡すと `ath` が入る。
 */
export function dpopProof(opts: {
  jwk: EcJwk;
  method: string;
  url: string;
  now: number; // epoch 秒
  nonce?: string;
  accessToken?: string;
  jti?: string;
}): string {
  const u = new URL(opts.url);
  const htu = `${u.origin}${u.pathname}`; // クエリ/フラグメントは htu から除く (RFC 9449)
  const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk(opts.jwk) };
  const payload: Record<string, unknown> = {
    jti: opts.jti ?? randomJti(),
    htm: opts.method.toUpperCase(),
    htu,
    iat: opts.now,
  };
  if (opts.nonce) payload.nonce = opts.nonce;
  if (opts.accessToken) payload.ath = accessTokenHash(opts.accessToken);
  return signEs256(header, payload, opts.jwk);
}

/**
 * client assertion (`private_key_jwt`, RFC 7523)。confidential client のトークンリクエストで
 * `client_assertion` として送る。`audience` は認可サーバーの issuer。
 */
export function clientAssertion(opts: {
  jwk: EcJwk;
  clientId: string;
  audience: string;
  now: number; // epoch 秒
  ttlSec?: number;
  jti?: string;
}): string {
  const header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT' };
  if (opts.jwk.kid) header.kid = opts.jwk.kid;
  const payload = {
    iss: opts.clientId,
    sub: opts.clientId,
    aud: opts.audience,
    jti: opts.jti ?? randomJti(),
    iat: opts.now,
    exp: opts.now + (opts.ttlSec ?? 60),
  };
  return signEs256(header, payload, opts.jwk);
}
