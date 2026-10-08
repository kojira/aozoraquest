/**
 * 管理データと service auth の NSID の唯一の定義 (Refs #718)。
 *
 * - 管理レコード (world.* / config.*) は env で分離する (#716): env が空でなければ
 *   `<root>.dev.*`、空/未設定 (本番) は `<root>.*`。web (VITE_NSID_ENV) と
 *   edge (ADMIN_NSID_ENV) はこの 1 関数で prefix を決める。
 * - scripts/*.mjs は TS を import できないので値を複製し、
 *   apps/edge/test/admin-nsid.test.ts が一致を検査する。
 */

/** 本家の NSID の根。web は fork 用に VITE_NSID_ROOT で差し替えられる。 */
export const AQ_NSID_ROOT = 'app.aozoraquest';

/** 管理者 PDS の world.* レコード名。並びは loadAdminWorld の読み込み順。 */
export const ADMIN_WORLD_RECORDS = ['map', 'tileArt', 'monsters', 'items', 'shops', 'npcs', 'jobs', 'interiors', 'quests', 'scenario', 'story'] as const;
export type AdminWorldRecordName = (typeof ADMIN_WORLD_RECORDS)[number];

/** 管理者 PDS の config.* レコード名。 */
export const ADMIN_CONFIG_RECORDS = ['flags', 'maintenance', 'bans', 'prompts'] as const;

/** 管理レコードの prefix。env が空でなければ `<root>.dev`、本番は `<root>`。 */
export function adminNsidPrefix(root: string, env: string | undefined): string {
  return env?.trim() ? `${root}.dev` : root;
}

/** `<prefix>.world.<name>`。 */
export function adminWorldCollection(prefix: string, name: AdminWorldRecordName): string {
  return `${prefix}.world.${name}`;
}

/** service auth の lexicon method (lxm)。エンドポイントごとに別値。web と edge が同じ値を使う。 */
export const LXM = {
  whoami: `${AQ_NSID_ROOT}.whoami`,
  meState: `${AQ_NSID_ROOT}.me.state`,
  worldMove: `${AQ_NSID_ROOT}.world.move`,
  worldTeleport: `${AQ_NSID_ROOT}.world.teleport`,
  worldItem: `${AQ_NSID_ROOT}.world.item`,
  worldGear: `${AQ_NSID_ROOT}.world.gear`,
  worldSearch: `${AQ_NSID_ROOT}.world.search`,
  worldReset: `${AQ_NSID_ROOT}.world.reset`,
  battleTurn: `${AQ_NSID_ROOT}.battle.turn`,
  xpClaim: `${AQ_NSID_ROOT}.xp.claim`,
  xpAdminSet: `${AQ_NSID_ROOT}.xp.adminSet`,
  powerAdminGrant: `${AQ_NSID_ROOT}.power.adminGrant`,
  powerSpend: `${AQ_NSID_ROOT}.power.spend`,
  shopCraft: `${AQ_NSID_ROOT}.shop.craft`,
  shopSell: `${AQ_NSID_ROOT}.shop.sell`,
  shopForge: `${AQ_NSID_ROOT}.shop.forge`,
  shopDiscard: `${AQ_NSID_ROOT}.shop.discard`,
  adminPdsUsage: `${AQ_NSID_ROOT}.admin.pdsUsage`,
  questAccept: `${AQ_NSID_ROOT}.quest.accept`,
  questComplete: `${AQ_NSID_ROOT}.quest.complete`,
  oauthStart: `${AQ_NSID_ROOT}.oauth.start`,
  oauthStatus: `${AQ_NSID_ROOT}.oauth.status`,
} as const;
