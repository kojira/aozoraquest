/**
 * ユーザー PDS に書き込む / 読み出す per-user な NSID の一元管理。
 *
 * 環境変数 `VITE_PDS_NS` で prefix を切替可能:
 *   - 未指定 (production): `app.aozoraquest`
 *   - dev 環境: `app.aozoraquest.dev` を Cloudflare Workers Builds の build env vars に設定
 *
 * これにより同じ Bluesky アカウントで dev / prod を行き来しても、
 * AozoraQuest 用のレコードが互いを上書きしない。
 *
 * 注意:
 * - 実 Bluesky 投稿 (`app.bsky.feed.post`) は性質上分離不可能なので、
 *   dev からの投稿も本物としてユーザーのタイムラインに乗る。
 * - admin が一元管理する global config (`app.aozoraquest.config.*` /
 *   `app.aozoraquest.directory`) は dev/prod で共有するため、ここには
 *   含めず runtime-config.ts 内で literal を使い続ける。
 */
const PREFIX = (import.meta.env.VITE_PDS_NS as string | undefined)?.trim() || 'app.aozoraquest';

export const COL = {
  analysis: `${PREFIX}.analysis`,
  profile: `${PREFIX}.profile`,
  spiritChat: `${PREFIX}.spiritChat`,
  questLog: `${PREFIX}.questLog`,
  cardDraw: `${PREFIX}.cardDraw`,
} as const;
