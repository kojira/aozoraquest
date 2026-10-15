import { describe, it, expect } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base64urlnopad } from '@scure/base';
import { signEs256, publicJwk, jwkThumbprint, dpopProof, clientAssertion, accessTokenHash, type EcJwk } from '../src/oauth-jwt';

/** テスト用の固定 P-256 JWK を作る (決定的な秘密鍵から x/y/d を導出)。 */
function makeJwk(): EcJwk {
  const d = new Uint8Array(32).fill(7); // 決定的な秘密スカラ (0 でも 32byte でもない有効値)
  const pub = p256.getPublicKey(d, false); // 0x04 || x(32) || y(32)
  return {
    kty: 'EC', crv: 'P-256',
    x: base64urlnopad.encode(pub.slice(1, 33)),
    y: base64urlnopad.encode(pub.slice(33, 65)),
    d: base64urlnopad.encode(d),
  };
}
const jwk = makeJwk();
const enc = new TextEncoder();
const dec = new TextDecoder();

/** JWT を検証: 署名が公開鍵で通り、header/payload を返す。 */
function verifyJwt(jwt: string, j: EcJwk): { header: Record<string, unknown>; payload: Record<string, unknown>; valid: boolean } {
  const [h, p, s] = jwt.split('.');
  const pub = new Uint8Array([4, ...base64urlnopad.decode(j.x), ...base64urlnopad.decode(j.y)]);
  const valid = p256.verify(base64urlnopad.decode(s), sha256(enc.encode(`${h}.${p}`)), pub, { lowS: true });
  return {
    header: JSON.parse(dec.decode(base64urlnopad.decode(h))),
    payload: JSON.parse(dec.decode(base64urlnopad.decode(p))),
    valid,
  };
}

describe('oauth-jwt (ES256 署名)', () => {
  it('signEs256 は p256 で検証可能な low-S 署名を作る', () => {
    const jwt = signEs256({ alg: 'ES256', typ: 'JWT' }, { hello: 'world', n: 1 }, jwk);
    const v = verifyJwt(jwt, jwk);
    expect(v.valid).toBe(true);
    expect(v.header).toMatchObject({ alg: 'ES256', typ: 'JWT' });
    expect(v.payload).toMatchObject({ hello: 'world', n: 1 });
  });

  it('改竄した payload は検証に失敗する', () => {
    const jwt = signEs256({ alg: 'ES256' }, { amount: 1 }, jwk);
    const [h, , s] = jwt.split('.');
    const tampered = `${h}.${base64urlnopad.encode(enc.encode(JSON.stringify({ amount: 999 })))}.${s}`;
    expect(verifyJwt(tampered, jwk).valid).toBe(false);
  });

  it('d の無い JWK では署名できない', () => {
    expect(() => signEs256({}, {}, publicJwk(jwk))).toThrow();
  });

  it('publicJwk は d/kid を落とす', () => {
    const pub = publicJwk({ ...jwk, kid: 'k1' });
    expect(pub.d).toBeUndefined();
    expect(pub.kid).toBeUndefined();
    expect(pub).toMatchObject({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
  });

  it('jwkThumbprint は決定的で公開鍵のみに依存 (d を含めても同じ)', () => {
    const t1 = jwkThumbprint(jwk);
    const t2 = jwkThumbprint(publicJwk(jwk));
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url(sha256) = 43 文字
  });

  it('dpopProof は typ=dpop+jwt・jwk 公開鍵・htm/htu を持ち、htu はクエリを除く', () => {
    const jwt = dpopProof({ jwk, method: 'post', url: 'https://pds.example/xrpc/com.atproto.repo.putRecord?foo=1#frag', now: 1000 });
    const v = verifyJwt(jwt, jwk);
    expect(v.valid).toBe(true);
    expect(v.header).toMatchObject({ typ: 'dpop+jwt', alg: 'ES256' });
    expect((v.header.jwk as EcJwk).d).toBeUndefined(); // 公開鍵のみ
    expect(v.payload).toMatchObject({ htm: 'POST', htu: 'https://pds.example/xrpc/com.atproto.repo.putRecord', iat: 1000 });
    expect(typeof v.payload.jti).toBe('string');
    expect(v.payload.nonce).toBeUndefined();
  });

  it('dpopProof は nonce と accessToken(ath) を入れられる', () => {
    const at = 'access-token-xyz';
    const jwt = dpopProof({ jwk, method: 'GET', url: 'https://pds.example/x', now: 5, nonce: 'N1', accessToken: at });
    const v = verifyJwt(jwt, jwk);
    expect(v.payload.nonce).toBe('N1');
    expect(v.payload.ath).toBe(accessTokenHash(at));
  });

  it('clientAssertion は iss=sub=clientId・aud・exp>iat の private_key_jwt', () => {
    const jwt = clientAssertion({ jwk, clientId: 'https://edge.example/client-metadata.json', audience: 'https://bsky.social', now: 100, ttlSec: 60 });
    const v = verifyJwt(jwt, jwk);
    expect(v.valid).toBe(true);
    expect(v.payload).toMatchObject({
      iss: 'https://edge.example/client-metadata.json',
      sub: 'https://edge.example/client-metadata.json',
      aud: 'https://bsky.social',
      iat: 100, exp: 160,
    });
  });
});
