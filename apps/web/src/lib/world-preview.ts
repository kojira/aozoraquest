/**
 * あおぞらワールドのプレビューゲート (docs/19-overworld.md §7 PR-W2)。
 *
 * 散歩プレビューは「dev だけで確認」する段階のため、本番 (VITE_NSID_ENV 未指定) では
 * 入口ボタンも /world 画面も出さない。dev 環境 (dev.aozoraquest.app) とローカル開発
 * でのみ有効。PR-W3 (消費・遭遇の配線) が本番に出せる段階になったらこのゲートを外す。
 */
export const WORLD_PREVIEW_ENABLED =
  import.meta.env.DEV || (import.meta.env.VITE_NSID_ENV as string | undefined)?.trim() === 'dev';
