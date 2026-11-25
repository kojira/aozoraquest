/**
 * AT Protocol の外部つなぎ先 (edge の単一の出所)。#1018
 *
 * 既定は本物の Bluesky ネットワーク (plc.directory、https の PDS / 認可サーバーだけ)。
 * ローカルだけで遊ぶ環境 (scripts/local-world) は wrangler dev の env で差し替える。
 * **未設定なら既定のまま** (dev / 本番の Worker には設定しない)。
 *
 * - PLC_DIRECTORY_URL   … did:plc の解決先 (既定 https://plc.directory)
 * - ALLOW_LOOPBACK_HTTP … "1" のとき、PDS / 認可サーバーに http://localhost・http://127.0.0.1 を許す
 *                         (ローカル PDS 用。ほかの http やプライベートアドレスは引き続き拒否)
 *
 * DID 解決 (service-auth) は env を受け取らない呼び出しが多いので、Worker の入口 (index.ts) で
 * リクエストごとに `configureAtprotoEndpoints(env)` を呼んで反映する。
 */
export interface AtprotoEndpointsEnv {
  PLC_DIRECTORY_URL?: string;
  ALLOW_LOOPBACK_HTTP?: string;
}

const DEFAULT_PLC_DIRECTORY_URL = 'https://plc.directory';

let plcUrl = DEFAULT_PLC_DIRECTORY_URL;
let loopbackHttp = false;

export function configureAtprotoEndpoints(env: AtprotoEndpointsEnv): void {
  plcUrl = env.PLC_DIRECTORY_URL?.trim().replace(/\/+$/, '') || DEFAULT_PLC_DIRECTORY_URL;
  loopbackHttp = env.ALLOW_LOOPBACK_HTTP?.trim() === '1';
}

/** did:plc の解決先 (末尾スラッシュ無し)。 */
export function plcDirectoryUrl(): string {
  return plcUrl;
}

/** ALLOW_LOOPBACK_HTTP=1 のとき、`url` が http://localhost / http://127.0.0.1 (ポート可) か。 */
export function isAllowedLoopbackHttp(url: URL): boolean {
  return loopbackHttp && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && !url.username && !url.password;
}

/** PDS / 認可サーバーとして使ってよい URL か。https は常に可、loopback の http は設定時だけ可。 */
export function isAllowedServiceUrl(raw: string): boolean {
  if (/^https:\/\//.test(raw)) return true;
  try {
    return isAllowedLoopbackHttp(new URL(raw));
  } catch {
    return false;
  }
}
