/**
 * AT Protocol OAuth のメタデータ discovery — docs/21 §12。
 *
 * サーバーアカウント (DID) から認可サーバーを解決する:
 *   DID → DID document の #atproto_pds → PDS の `/.well-known/oauth-protected-resource`
 *   → `authorization_servers[0]` → `/.well-known/oauth-authorization-server` (メタデータ)。
 *
 * DID 解決は service-auth の `resolveDidDocument` を再利用 (did:plc / did:web、SSRF 対策込み)。
 */
import { resolveDidDocument, ServiceAuthError } from './service-auth';

/** service 配列込みの DID document (service-auth 側は verificationMethod だけの狭い型)。 */
interface DidDocWithService {
  id: string;
  service?: { id: string; type: string; serviceEndpoint: string }[];
}

/** 認可サーバーメタデータ (RFC 8414 + AT Proto プロファイル)。使う項目だけ。 */
export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  /** AT Proto は PAR 必須。 */
  pushed_authorization_request_endpoint: string;
  /** DPoP 対応アルゴリズム (ES256 が含まれること)。 */
  dpop_signing_alg_values_supported?: string[];
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

/** DID document から PDS エンドポイント (#atproto_pds) を取り出す。 */
export function pdsEndpointFromDoc(doc: DidDocWithService, did: string): string {
  const svc = doc.service?.find((s) => s.id === '#atproto_pds' || s.id === `${did}#atproto_pds` || s.type === 'AtprotoPersonalDataServer');
  const ep = svc?.serviceEndpoint;
  if (!ep || !/^https:\/\//.test(ep)) throw new ServiceAuthError(`#atproto_pds エンドポイントが見つからない: ${did}`);
  return ep.replace(/\/$/, '');
}

async function fetchJson<T>(url: string, f: typeof fetch): Promise<T> {
  const res = await f(url);
  if (!res.ok) throw new ServiceAuthError(`メタデータ取得失敗 ${res.status}: ${url}`);
  return (await res.json()) as T;
}

/**
 * PDS URL から認可サーバーメタデータを解決・検証する。
 * - protected-resource の authorization_servers[0] を採用。
 * - メタデータの issuer が **その認可サーバー URL と一致**することを確認 (mix-up 対策)。
 * - PAR エンドポイント必須 (AT Proto)。ES256 の DPoP 対応を確認。
 */
export async function discoverAuthServer(pdsUrl: string, fetchImpl: typeof fetch = fetch): Promise<AuthServerMetadata> {
  const pr = await fetchJson<{ authorization_servers?: string[] }>(`${pdsUrl}/.well-known/oauth-protected-resource`, fetchImpl);
  const as0 = pr.authorization_servers?.[0];
  if (!as0 || !/^https:\/\//.test(as0)) throw new ServiceAuthError('protected-resource に authorization_servers が無い');
  const issuerBase = as0.replace(/\/$/, '');

  const meta = await fetchJson<AuthServerMetadata>(`${issuerBase}/.well-known/oauth-authorization-server`, fetchImpl);
  // mix-up 攻撃対策: issuer は要求した認可サーバーと一致必須 (RFC 8414 §3.3 / 9207)。
  if (meta.issuer?.replace(/\/$/, '') !== issuerBase) {
    throw new ServiceAuthError(`issuer 不一致: メタデータ ${meta.issuer} ≠ ${issuerBase}`);
  }
  if (!meta.pushed_authorization_request_endpoint) throw new ServiceAuthError('PAR エンドポイントが無い (AT Proto は PAR 必須)');
  if (!meta.authorization_endpoint || !meta.token_endpoint) throw new ServiceAuthError('authorization/token エンドポイントが無い');
  if (meta.dpop_signing_alg_values_supported && !meta.dpop_signing_alg_values_supported.includes('ES256')) {
    throw new ServiceAuthError('認可サーバーが DPoP ES256 に非対応');
  }
  return meta;
}

/** DID から認可サーバーメタデータまで一括解決 (DID → PDS → 認可サーバー)。 */
export async function discoverForDid(did: string, fetchImpl: typeof fetch = fetch): Promise<{ pdsUrl: string; authServer: AuthServerMetadata }> {
  const doc = (await resolveDidDocument(did, fetchImpl)) as DidDocWithService;
  const pdsUrl = pdsEndpointFromDoc(doc, did);
  const authServer = await discoverAuthServer(pdsUrl, fetchImpl);
  return { pdsUrl, authServer };
}
