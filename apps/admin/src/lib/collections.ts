/**
 * 主管理者 PDS に書き込む global config の NSID。
 *
 * 環境変数 VITE_NSID_ROOT (必須) でプロジェクト固有 prefix を指定する。
 * 例: 本家 = "app.aozoraquest", fork = "com.example.myapp"
 *
 * 未指定だと build を失敗させる (silent に誤デプロイするのを防ぐ)。
 *
 * web 側 (apps/web/src/lib/collections.ts ADMIN_COL) と完全同形にすること。
 */
const ROOT = (import.meta.env.VITE_NSID_ROOT as string | undefined)?.trim();
if (!ROOT) {
  throw new Error(
    'VITE_NSID_ROOT is required (e.g. "app.aozoraquest"). ' +
      'Set it in the Cloudflare Workers Builds env vars per project.',
  );
}

export const ADMIN_COL = {
  configFlags: `${ROOT}.config.flags`,
  configMaintenance: `${ROOT}.config.maintenance`,
  configBans: `${ROOT}.config.bans`,
  configPrompts: `${ROOT}.config.prompts`,
  directory: `${ROOT}.directory`,
} as const;
