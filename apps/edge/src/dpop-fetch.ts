/**
 * DPoP バインド付き fetch — docs/21 §12。RFC 9449。
 *
 * AT Protocol OAuth のトークン取得・PDS アクセスは全て DPoP (sender-constrained) を要求する。
 * サーバーは初回に `DPoP-Nonce` を発行し `use_dpop_nonce` エラーを返すので、**その nonce で 1 回だけ
 * 作り直して再送**する必要がある。この handshake を本ヘルパーに閉じ込め、OAuth クライアントと
 * PDS 書き込みの両方から使う。nonce は接続をまたいで再利用できるよう `onNonce` で外に出す。
 */
import { dpopProof, type EcJwk } from './oauth-jwt';

export interface DpopFetchOptions {
  /** DPoP 署名鍵 (P-256 秘密鍵 JWK)。 */
  jwk: EcJwk;
  /** 直近に受け取った DPoP-Nonce (あれば最初から付ける)。 */
  nonce?: string;
  /** access token (付けると Authorization: DPoP <token> と ath クレームが入る)。 */
  accessToken?: string;
  /** epoch 秒。テスト用に注入可 (省略時は現在時刻)。 */
  now?: number;
  /** サーバーが新しい DPoP-Nonce を返したら通知 (呼び出し側でキャッシュ更新)。 */
  onNonce?: (nonce: string) => void;
  /** fetch 実装 (テスト用)。 */
  fetchImpl?: typeof fetch;
}

/** レスポンスが「nonce を付けて出し直せ (use_dpop_nonce)」を意味するか。body は clone して読む。 */
async function isUseDpopNonce(res: Response): Promise<boolean> {
  if (res.status !== 400 && res.status !== 401) return false;
  const auth = res.headers.get('www-authenticate') ?? '';
  if (auth.includes('use_dpop_nonce')) return true;
  try {
    const body = (await res.clone().json()) as { error?: string };
    return body.error === 'use_dpop_nonce';
  } catch {
    return false;
  }
}

/**
 * DPoP proof を付けて fetch。`use_dpop_nonce` チャレンジには受け取った nonce で 1 回だけ再送する。
 * DPoP-Nonce レスポンスヘッダは毎回 `onNonce` に通知し、次回以降に使えるようにする。
 */
export async function dpopFetch(url: string, init: RequestInit, opts: DpopFetchOptions): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const method = (init.method ?? 'GET').toUpperCase();
  let nonce = opts.nonce;

  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = dpopProof({ jwk: opts.jwk, method, url, now, nonce, accessToken: opts.accessToken });
    const headers = new Headers(init.headers);
    headers.set('DPoP', proof);
    if (opts.accessToken) headers.set('Authorization', `DPoP ${opts.accessToken}`);

    const res = await f(url, { ...init, headers });

    const fresh = res.headers.get('DPoP-Nonce');
    if (fresh && fresh !== nonce) {
      nonce = fresh;
      opts.onNonce?.(fresh);
    }
    // 初回で nonce 要求 & 新 nonce を得たなら、その nonce で 1 回だけ出し直す。
    if (attempt === 0 && fresh && (await isUseDpopNonce(res))) continue;
    return res;
  }
  // 到達しない (ループは必ず return する) が、型のため。
  throw new Error('dpopFetch: unreachable');
}
