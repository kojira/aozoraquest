// ローカル edge 用の P-256 秘密鍵 JWK を作る (apps/edge/scripts/gen-oauth-keys.mjs と同じ形)。ローカル専用。
import crypto from 'node:crypto';

export function generateP256Jwk() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const kid = crypto.createHash('sha256').update(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`).digest('base64url');
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, kid };
}
