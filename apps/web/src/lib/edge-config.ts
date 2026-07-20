/**
 * エッジ Worker の URL / DID の**環境別解決** (単一の出所)。
 *
 * dev branch デプロイ (`VITE_NSID_ENV=dev`) は **dev エッジを強制**する。`.env.production` は
 * 本番/dev 両ビルドが読むため `VITE_EDGE_URL` が共有エッジを指してしまい、dev が本番エッジを
 * 叩く事故が起きる (#396)。エッジを叩く全モジュール (world-server / server-oauth) がここを
 * import して**同じエッジ**を使う ← 連携先とワールド呼び出し先がズレる不具合を防ぐ。
 *
 * エッジ URL は secret でなく公開インフラ値 (既に .env に commit 済) なのでコードに置いてよい。
 * dev エッジをリネーム/再デプロイした時はこの定数と .env.development を直す (docs/22)。
 */
const NSID_ENV = (import.meta.env.VITE_NSID_ENV as string | undefined)?.trim();
const DEV_EDGE_URL = 'https://aozoraquest-edge-dev.kojiran.workers.dev';
const DEV_EDGE_DID = 'did:web:aozoraquest-edge-dev.kojiran.workers.dev';

export const EDGE_URL = NSID_ENV === 'dev' ? DEV_EDGE_URL : (import.meta.env.VITE_EDGE_URL as string | undefined)?.trim();
export const EDGE_DID = NSID_ENV === 'dev' ? DEV_EDGE_DID : (import.meta.env.VITE_EDGE_DID as string | undefined)?.trim();
