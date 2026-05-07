/**
 * このアプリが PDS に書き込む / 読み出す NSID の一元管理。
 *
 * 環境変数:
 *   - VITE_NSID_ROOT (必須): プロジェクト固有の NSID prefix。
 *       例: 本家 = "app.aozoraquest", fork = "com.example.myapp"
 *   - VITE_NSID_ENV (任意): 同一プロジェクト内で env を分離する suffix。
 *       例: dev = "dev" → user 記録は "{ROOT}.dev.{name}" に書く。
 *       未指定 = production 扱いで "{ROOT}.{name}" に書く。
 *
 * Cloudflare Workers Builds の build env vars に必ず設定する。
 * 未指定だと build を失敗させる (silent に誤デプロイするのを防ぐ)。
 *
 * 区分:
 *   - user 系 (per-user PDS, env で分離する) → COL
 *       analysis / profile / spiritChat / questLog / cardDraw
 *   - admin 系 (主管理者の PDS, 全 env 共有) → ADMIN_COL
 *       config.flags / config.maintenance / config.bans / config.prompts /
 *       directory
 *
 * 注意:
 * - 実 Bluesky 投稿 (`app.bsky.feed.post`) は性質上分離不可、
 *   dev からの投稿も実投稿になる。
 */
const ROOT = (import.meta.env.VITE_NSID_ROOT as string | undefined)?.trim();
if (!ROOT) {
  throw new Error(
    'VITE_NSID_ROOT is required (e.g. "app.aozoraquest"). ' +
      'Set it in the Cloudflare Workers Builds env vars per project.',
  );
}
const ENV = (import.meta.env.VITE_NSID_ENV as string | undefined)?.trim();
const USER_PREFIX = ENV ? `${ROOT}.${ENV}` : ROOT;

export const COL = {
  analysis: `${USER_PREFIX}.analysis`,
  profile: `${USER_PREFIX}.profile`,
  spiritChat: `${USER_PREFIX}.spiritChat`,
  questLog: `${USER_PREFIX}.questLog`,
  cardDraw: `${USER_PREFIX}.cardDraw`,
  /** あおぞらパワーの累積カウンタ (rkey='self')。アクションごとに増分する。
   *  初回読み取り時に旧データから一度だけスキャン → 書き込みでマイグレーション。 */
  power: `${USER_PREFIX}.power`,
} as const;

/**
 * 他ユーザーのレコードを読みに行くときの NSID (ROOT 直下 = production view)。
 *
 * 自分の WRITE は env-isolated な COL.* に行くが、他ユーザーは production
 * NSID にしか書いていない。dev 環境の resonance タイムラインや friends 画面で
 * 他者の archetype を表示するためには ROOT_COL から読む必要がある。
 *
 * production 環境 (VITE_NSID_ENV 未指定) では COL と ROOT_COL は同値になる。
 */
export const ROOT_COL = {
  analysis: `${ROOT}.analysis`,
  profile: `${ROOT}.profile`,
} as const;

export const ADMIN_COL = {
  configFlags: `${ROOT}.config.flags`,
  configMaintenance: `${ROOT}.config.maintenance`,
  configBans: `${ROOT}.config.bans`,
  configPrompts: `${ROOT}.config.prompts`,
  directory: `${ROOT}.directory`,
} as const;
