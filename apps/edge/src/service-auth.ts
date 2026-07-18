/**
 * AT Protocol の service auth (inter-service JWT) 検証 (docs/21-server-authority §4.2)。
 *
 * クライアントが `com.atproto.server.getServiceAuth({aud, lxm, exp})` で発行した短命 JWT を
 * 受け、発行者 (iss) DID の署名鍵で検証して「呼び出し元 = iss DID」を確定する。
 *
 * Cloudflare Workers 上で動かすため、Node 依存の無い純 JS だけで実装:
 *   - 署名検証: @noble/curves (secp256k1=ES256K / p256=ES256)。Workers の crypto.subtle は
 *     secp256k1 を持たないので noble で自前検証する。
 *   - base58/base64url: @scure/base、sha256: @noble/hashes。
 *
 * AT Proto 鍵の大半は secp256k1 (ES256K)。DID document の #atproto 署名鍵 (Multikey,
 * publicKeyMultibase) を multicodec からデコードして使う。
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { base58, base64urlnopad } from '@scure/base';
import { verifySecp256k1 } from './secp256k1-wasm';

export type Curve = 'secp256k1' | 'p256';
export interface SigningKey {
  curve: Curve;
  /** 圧縮公開鍵 (33 bytes) */
  pubkey: Uint8Array;
}

/** multicodec prefix (varint)。secp256k1-pub = 0xe7 0x01 / p256-pub = 0x80 0x24。 */
const MULTICODEC: Record<string, { curve: Curve; prefix: [number, number] }> = {
  secp256k1: { curve: 'secp256k1', prefix: [0xe7, 0x01] },
  p256: { curve: 'p256', prefix: [0x80, 0x24] },
};
const ALG_FOR_CURVE: Record<Curve, string> = { secp256k1: 'ES256K', p256: 'ES256' };

export class ServiceAuthError extends Error {}

/** did:key / Multikey の publicKeyMultibase ("z...") を曲線 + 圧縮公開鍵にデコード。 */
export function decodeMultikey(multibase: string): SigningKey {
  if (!multibase.startsWith('z')) throw new ServiceAuthError('multikey は base58btc (z...) のみ対応');
  const bytes = base58.decode(multibase.slice(1));
  for (const { curve, prefix } of Object.values(MULTICODEC)) {
    if (bytes[0] === prefix[0] && bytes[1] === prefix[1]) {
      const pubkey = bytes.slice(2);
      if (pubkey.length !== 33) throw new ServiceAuthError(`圧縮公開鍵は 33 bytes のはず (got ${pubkey.length})`);
      return { curve, pubkey };
    }
  }
  throw new ServiceAuthError(`未対応の multicodec prefix: ${bytes[0]?.toString(16)} ${bytes[1]?.toString(16)}`);
}

interface DidDocument {
  id: string;
  verificationMethod?: { id: string; type: string; controller?: string; publicKeyMultibase?: string }[];
}

/** did:web の host が SSRF 面で危険 (IP リテラル / localhost / リンクローカル / ポート付き) か。
 *  iss は攻撃者が JWT に自由に書けるので、任意ホストへの fetch 誘発を弾く (レビュー ★★)。 */
function isUnsafeDidWebHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.includes(':') || h.includes('%3a')) return true; // ポート付き (did:web はポートを %3A で表す)
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 リテラル
  if (h.startsWith('[') || /^[0-9a-f:]+$/.test(h)) return true; // IPv6 リテラル
  if (!h.includes('.')) return true; // ドットの無いホスト (内部名) は拒否
  return false;
}

/** DID document を解決 (did:plc → plc.directory / did:web → .well-known)。fetchFn は差し替え可 (テスト)。 */
export async function resolveDidDocument(did: string, fetchFn: typeof fetch = fetch): Promise<DidDocument> {
  let url: string;
  if (did.startsWith('did:plc:')) {
    url = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const rest = did.slice('did:web:'.length);
    const parts = rest.split(':').map(decodeURIComponent);
    const host = parts[0]!;
    if (isUnsafeDidWebHost(host)) throw new ServiceAuthError(`did:web の host が不許可 (SSRF 対策): ${host}`);
    url = parts.length === 1 ? `https://${host}/.well-known/did.json` : `https://${host}/${parts.slice(1).join('/')}/did.json`;
  } else {
    throw new ServiceAuthError(`未対応の DID method: ${did}`);
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new ServiceAuthError(`DID 解決失敗 ${res.status}: ${did}`);
  return (await res.json()) as DidDocument;
}

/** DID document から #atproto 署名鍵を取り出してデコード。fragment を厳密一致させ、
 *  フォールバック (最初の任意鍵) はしない — rotation key 等を signing key と取り違えない
 *  ため (攻撃者が自作できる did:web で別用途鍵を通す余地を塞ぐ。レビュー ★★)。 */
export function signingKeyFromDoc(doc: DidDocument, did: string): SigningKey {
  const vms = doc.verificationMethod ?? [];
  const vm = vms.find((v) => v.id.split('#')[1] === 'atproto' && v.publicKeyMultibase);
  if (!vm?.publicKeyMultibase) throw new ServiceAuthError(`#atproto 署名鍵が見つからない: ${did}`);
  return decodeMultikey(vm.publicKeyMultibase);
}

interface JwtParts {
  header: { alg?: string; typ?: string };
  payload: { iss?: string; aud?: string; exp?: number; iat?: number; lxm?: string; jti?: string };
  signingInput: Uint8Array;
  signature: Uint8Array;
}

/** compact JWT (a.b.c) をパース。署名は raw r||s (64 bytes) 前提 (ES256K/ES256)。 */
export function parseJwt(token: string): JwtParts {
  const parts = token.split('.');
  if (parts.length !== 3) throw new ServiceAuthError('JWT の形式が不正 (3 セグメントでない)');
  const [h, p, s] = parts as [string, string, string];
  const dec = new TextDecoder();
  const header = JSON.parse(dec.decode(base64urlnopad.decode(h)));
  const payload = JSON.parse(dec.decode(base64urlnopad.decode(p)));
  const signature = base64urlnopad.decode(s);
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  return { header, payload, signingInput, signature };
}

export interface VerifyOptions {
  /** この Worker の DID。JWT の aud がこれと厳格一致すること。 */
  audience: string;
  /** 呼び出し先メソッド (lexicon method)。JWT の lxm と一致すること。省略時は lxm 検証しない。 */
  lxm?: string;
  /** 現在時刻 (unix 秒)。省略時 Date.now()。テストで固定可。 */
  now?: number;
  /** 時計スキュー許容 (秒)。既定 60。 */
  clockToleranceSec?: number;
  /** DID document 解決関数 (テストで差し替え)。 */
  resolveDid?: (did: string) => Promise<DidDocument>;
}

/**
 * service auth JWT を検証して発行者 DID (= 呼び出し元) を返す。§4.2 チェックリストを全て適用:
 * alg / typ / aud / lxm / exp / iat / iss=解決鍵で確定 / 署名。失敗は ServiceAuthError (fail-closed)。
 */
export async function verifyServiceAuth(token: string, opts: VerifyOptions): Promise<{ iss: string }> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockToleranceSec ?? 60;
  const { header, payload, signingInput, signature } = parseJwt(token);

  // alg confusion 対策: 想定した alg のみ許可 ("none" や想定外 curve を拒否)
  if (header.alg !== 'ES256K' && header.alg !== 'ES256') throw new ServiceAuthError(`未許可の alg: ${header.alg}`);
  const iss = payload.iss;
  if (!iss || !iss.startsWith('did:')) throw new ServiceAuthError('iss (DID) が無い');
  if (payload.aud !== opts.audience) throw new ServiceAuthError('aud 不一致 (この Worker 宛でない)');
  if (opts.lxm !== undefined && payload.lxm !== opts.lxm) throw new ServiceAuthError('lxm 不一致 (エンドポイント越境)');
  // exp はスキューを足さず厳格に (短命 JWT の寿命を延ばさない)。スキューは iat の未来ズレ側に効かせる。
  if (typeof payload.exp !== 'number' || now > payload.exp) throw new ServiceAuthError('JWT 期限切れ or exp 無し');
  if (typeof payload.iat === 'number' && payload.iat > now + skew) throw new ServiceAuthError('iat が未来');

  // iss を解決した鍵で署名検証 (ヘッダの鍵は信じない)
  const resolve = opts.resolveDid ?? ((d: string) => resolveDidDocument(d));
  const doc = await resolve(iss);
  if (doc.id !== iss) throw new ServiceAuthError('DID document の id が iss と不一致');
  const key = signingKeyFromDoc(doc, iss);
  if (ALG_FOR_CURVE[key.curve] !== header.alg) throw new ServiceAuthError('alg と署名鍵の曲線が不一致');

  if (signature.length !== 64) throw new ServiceAuthError('署名は raw r||s (64 bytes) のはず');
  // secp256k1 (ES256K, AT Proto の主流) は verify 専用 WASM (k256, ~51KB) で高速検証
  // (署名対象を渡し wasm 内で SHA-256)。p256 (ES256, 少数) は @noble (純 JS、prehash)。
  // low-S を強制 (署名 malleability 対策)。secp256k1 は wasm 側 (normalize_s) で拒否。
  // p256 は @noble に { lowS: true } を渡す。AT Proto 準拠署名は必ず low-S なので実害なし。
  const ok =
    key.curve === 'secp256k1'
      ? verifySecp256k1(signingInput, key.pubkey, signature)
      : p256.verify(signature, sha256(signingInput), key.pubkey, { lowS: true });
  if (!ok) throw new ServiceAuthError('署名検証に失敗');

  return { iss };
}
