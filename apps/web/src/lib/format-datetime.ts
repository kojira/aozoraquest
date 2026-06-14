/**
 * 日時表記はこのモジュールに集約する (アプリ全体で生成関数を統一)。
 *
 * 方針:
 * - 投稿カード (post-metrics) / 通知 (notification-item): いつの投稿か特定できるよう
 *   `formatDateTime` のフル表記 (年月日 + 秒まで)。秒は残す (オーナー方針)。
 * - 当日の行動ログ (home-summary の監査ログ) のように日付が自明な文脈: `formatTime`
 *   の時刻のみ (HH:MM)。
 * 表示サイズは配置の都合でレイアウト側が決める (投稿=小さく右端 / 通知=1 行に収める)。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 文字列を "YYYY/MM/DD HH:MM:SS" (ローカルタイムゾーン) に整形。 */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return (
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** ISO 文字列を "HH:MM" (ローカルタイムゾーン) に整形。日付が自明な文脈用。 */
export function formatTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
