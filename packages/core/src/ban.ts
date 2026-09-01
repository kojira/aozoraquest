/**
 * **BAN リスト** (docs/14-admin §(d))。主管理者 PDS の公開レコード 1 本に DID を並べる。
 *
 * **効くのはあおぞらワールドだけ。** 投稿・タイムライン・バッジ・依頼クエスト板には
 * 効かせない — それらは Bluesky の公開データで、こちらで除外しても他のクライアントからは
 * 見えるので意味が薄い。ワールドは権威 state (パワー・XP・在庫) をこちらが持っているので、
 * そこへの書き込みを止めることに意味がある。
 *
 * web (画面を出さない) と edge (権威 API を 403 で拒む) の両方がこのレコードを読むので、
 * **collection・rkey・形・判定はここ 1 か所**に置く。別々に書くと片方だけ効く/効かないが起きる。
 */

/** NSID の根に続く collection 名。web の `ADMIN_COL.configBans` と edge の loader が同じ値を組む。 */
export const BANS_COLLECTION_SUFFIX = 'config.bans';
/** シングルトンなので rkey は固定。 */
export const BANS_RKEY = 'self';

/** `bansCollection('app.aozoraquest')` → `app.aozoraquest.config.bans`。 */
export function bansCollection(nsidRoot: string): string {
  return `${nsidRoot}.${BANS_COLLECTION_SUFFIX}`;
}

/** レコードの形。`@aozoraquest/types` の `ConfigBansSchema` が検証側の定義 (こちらは読み書きの最小形)。 */
export interface BansRecord {
  dids: string[];
  updatedAt: string;
}

/** BAN 済みか。`bans` は読み込んだリスト、`did` は認証済みの本人 DID。未ログイン (did 無し) は false。 */
export function isBanned(bans: readonly string[], did: string | null | undefined): boolean {
  if (!did) return false;
  return bans.includes(did);
}
