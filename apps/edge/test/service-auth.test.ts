import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base58, base64urlnopad } from '@scure/base';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/abstract/utils';
import { verifyServiceAuth, resolveDidDocument, signingKeyFromDoc, decodeMultikey, ServiceAuthError, type Curve } from '../src/service-auth';
import { initSecp256k1 } from '../src/secp256k1-wasm';

// テスト (node) では wasm を fs で読んで初期化 (Worker は index.ts が .wasm import を渡す)。
beforeAll(() => {
  const bytes = readFileSync(new URL('../src/vendor/secp256k1-verify/secp256k1_verify_bg.wasm', import.meta.url));
  initSecp256k1(bytes);
});

// ─── テスト用ヘルパー: 鍵・multikey・署名付き JWT を作る ───

const CURVES = { secp256k1, p256 } as const;
const PREFIX: Record<Curve, [number, number]> = { secp256k1: [0xe7, 0x01], p256: [0x80, 0x24] };

function multikey(curve: Curve, pubCompressed: Uint8Array): string {
  const [a, b] = PREFIX[curve];
  const bytes = new Uint8Array([a, b, ...pubCompressed]);
  return 'z' + base58.encode(bytes);
}

function b64urlJson(obj: unknown): string {
  return base64urlnopad.encode(new TextEncoder().encode(JSON.stringify(obj)));
}

/** did + 署名鍵から DID document を作る (resolveDid モックが返す形)。 */
function didDoc(did: string, curve: Curve, pubCompressed: Uint8Array) {
  return { id: did, verificationMethod: [{ id: `${did}#atproto`, type: 'Multikey', publicKeyMultibase: multikey(curve, pubCompressed) }] };
}

/** 署名付き service auth JWT を組み立てる。 */
function makeJwt(curve: Curve, priv: Uint8Array, payload: Record<string, unknown>): string {
  const alg = curve === 'secp256k1' ? 'ES256K' : 'ES256';
  const head = b64urlJson({ alg, typ: 'JWT' });
  const body = b64urlJson(payload);
  const signingInput = new TextEncoder().encode(`${head}.${body}`);
  // AT Proto は low-S 必須。noble の p256.sign は既定 high-S なので明示的に low-S で署名する。
  const sig = CURVES[curve].sign(sha256(signingInput), priv, { lowS: true }).toCompactRawBytes();
  return `${head}.${body}.${base64urlnopad.encode(sig)}`;
}

const AUD = 'did:web:edge.aozoraquest.app';
const NOW = 1_800_000_000;

function setup(curve: Curve, did = 'did:plc:alice') {
  const priv = CURVES[curve].utils.randomPrivateKey();
  const pub = CURVES[curve].getPublicKey(priv, true); // 圧縮 33 bytes
  const resolveDid = async (d: string) => {
    if (d !== did) throw new Error(`unexpected did ${d}`);
    return didDoc(did, curve, pub);
  };
  return { priv, pub, did, resolveDid };
}

describe('service auth JWT 検証 (Workers 互換の自前実装)', () => {
  for (const curve of ['secp256k1', 'p256'] as const) {
    describe(curve, () => {
      it('正規の JWT を検証して iss を返す', async () => {
        const { priv, did, resolveDid } = setup(curve);
        const token = makeJwt(curve, priv, { iss: did, aud: AUD, lxm: 'com.example.foo', exp: NOW + 60, iat: NOW });
        const r = await verifyServiceAuth(token, { audience: AUD, lxm: 'com.example.foo', now: NOW, resolveDid });
        expect(r.iss).toBe(did);
      });

      it('署名を改ざんすると失敗', async () => {
        const { priv, did, resolveDid } = setup(curve);
        const token = makeJwt(curve, priv, { iss: did, aud: AUD, exp: NOW + 60, iat: NOW });
        const tampered = token.slice(0, -3) + (token.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
        await expect(verifyServiceAuth(tampered, { audience: AUD, now: NOW, resolveDid })).rejects.toBeInstanceOf(ServiceAuthError);
      });

      it('別の鍵で署名 (なりすまし) は失敗', async () => {
        const { did, resolveDid } = setup(curve);
        const attacker = CURVES[curve].utils.randomPrivateKey();
        const token = makeJwt(curve, attacker, { iss: did, aud: AUD, exp: NOW + 60, iat: NOW });
        await expect(verifyServiceAuth(token, { audience: AUD, now: NOW, resolveDid })).rejects.toBeInstanceOf(ServiceAuthError);
      });
    });
  }

  it('aud 不一致 (別サービス宛 JWT の流用) を拒否', async () => {
    const { priv, did, resolveDid } = setup('secp256k1');
    const token = makeJwt('secp256k1', priv, { iss: did, aud: 'did:web:evil.example', exp: NOW + 60, iat: NOW });
    await expect(verifyServiceAuth(token, { audience: AUD, now: NOW, resolveDid })).rejects.toThrow(/aud/);
  });

  it('lxm 不一致 (エンドポイント越境) を拒否', async () => {
    const { priv, did, resolveDid } = setup('secp256k1');
    const token = makeJwt('secp256k1', priv, { iss: did, aud: AUD, lxm: 'com.a.whoami', exp: NOW + 60, iat: NOW });
    await expect(verifyServiceAuth(token, { audience: AUD, lxm: 'com.a.resolve', now: NOW, resolveDid })).rejects.toThrow(/lxm/);
  });

  it('期限切れ JWT を拒否', async () => {
    const { priv, did, resolveDid } = setup('secp256k1');
    const token = makeJwt('secp256k1', priv, { iss: did, aud: AUD, exp: NOW - 3600, iat: NOW - 3660 });
    await expect(verifyServiceAuth(token, { audience: AUD, now: NOW, resolveDid })).rejects.toThrow(/期限/);
  });

  it('alg confusion (none / 想定外) を拒否', async () => {
    const { priv, did, resolveDid } = setup('secp256k1');
    // alg を偽装 (payload は正規、header の alg だけ none)
    const head = b64urlJson({ alg: 'none', typ: 'JWT' });
    const body = b64urlJson({ iss: did, aud: AUD, exp: NOW + 60, iat: NOW });
    const signingInput = new TextEncoder().encode(`${head}.${body}`);
    const sig = secp256k1.sign(sha256(signingInput), priv).toCompactRawBytes();
    const token = `${head}.${body}.${base64urlnopad.encode(sig)}`;
    await expect(verifyServiceAuth(token, { audience: AUD, now: NOW, resolveDid })).rejects.toThrow(/alg/);
  });

  // 正規署名の s を n-s に置換して high-S にする (malleability)
  function toHighS(curve: Curve, sig: Uint8Array): Uint8Array {
    const n = (CURVES[curve] as unknown as { CURVE: { n: bigint } }).CURVE.n;
    const r = sig.slice(0, 32);
    const s = bytesToNumberBE(sig.slice(32));
    return new Uint8Array([...r, ...numberToBytesBE(n - s, 32)]);
  }

  it('high-S 署名を拒否する (malleability 対策、両曲線)', async () => {
    for (const curve of ['secp256k1', 'p256'] as const) {
      const { priv, did, resolveDid } = setup(curve);
      const head = b64urlJson({ alg: curve === 'secp256k1' ? 'ES256K' : 'ES256', typ: 'JWT' });
      const body = b64urlJson({ iss: did, aud: AUD, exp: NOW + 60, iat: NOW });
      const si = new TextEncoder().encode(`${head}.${body}`);
      const low = CURVES[curve].sign(sha256(si), priv, { lowS: true }).toCompactRawBytes();
      const token = `${head}.${body}.${base64urlnopad.encode(toHighS(curve, low))}`;
      await expect(verifyServiceAuth(token, { audience: AUD, now: NOW, resolveDid })).rejects.toBeInstanceOf(ServiceAuthError);
    }
  });

  it('did:web の危険な host (IP/localhost/ポート/ドット無し) は解決を拒否 (SSRF)', async () => {
    const okFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    for (const bad of ['did:web:127.0.0.1', 'did:web:localhost', 'did:web:169.254.169.254', 'did:web:example.com%3A8080', 'did:web:internalhost']) {
      await expect(resolveDidDocument(bad, okFetch)).rejects.toBeInstanceOf(ServiceAuthError);
    }
  });

  it('#atproto 以外の鍵にはフォールバックしない (rotation key を signing key と取り違えない)', () => {
    const priv = secp256k1.utils.randomPrivateKey();
    const pub = secp256k1.getPublicKey(priv, true);
    const doc = { id: 'did:plc:x', verificationMethod: [{ id: 'did:plc:x#rotation', type: 'Multikey', publicKeyMultibase: multikey('secp256k1', pub) }] };
    expect(() => signingKeyFromDoc(doc, 'did:plc:x')).toThrow(ServiceAuthError);
  });

  it('decodeMultikey は multicodec prefix で曲線を判定し 33byte 公開鍵を返す', () => {
    for (const curve of ['secp256k1', 'p256'] as const) {
      const priv = CURVES[curve].utils.randomPrivateKey();
      const pub = CURVES[curve].getPublicKey(priv, true);
      const decoded = decodeMultikey(multikey(curve, pub));
      expect(decoded.curve).toBe(curve);
      expect(decoded.pubkey.length).toBe(33);
      expect([...decoded.pubkey]).toEqual([...pub]);
    }
  });
});
