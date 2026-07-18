/**
 * ブルスコンの試練の 1 日あたり挑戦回数の上限 (オーナー要望 2026-07-18)。
 *
 * 「1 日」は JST 暦日 (00:00 JST 区切り)。APP_VERSION 等と同じく本アプリの
 * 時刻基準は JST に揃える。カウントは試練の戦闘レコード (source='trial') を
 * その日ぶん数える — 途中離脱 (棄権) も仮レコードが残るので 1 回と数える
 * (負けそうで閉じて数え直す、を無料にしない。パワー消費と同じ考え方)。
 *
 * 野外遭遇 (source='world') は上限の対象外。旧レコード (source 欠落) は
 * 本番では全て試練なので試練として数える。
 */

export const TRIAL_DAILY_LIMIT = 10;

/** ISO 時刻を JST 暦日キー (YYYY-MM-DD) に変換する。純関数。 */
export function jstDayKey(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  // JST = UTC+9 (DST なし)。9h ずらして UTC 日付部を取れば JST 暦日になる
  const d = new Date(t + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** レコード群のうち「今日 (JST) の試練」を数える。source 欠落 = 試練扱い。 */
export function countTrialsToday(
  records: readonly { at?: string; source?: string }[],
  nowIso: string,
): number {
  const today = jstDayKey(nowIso);
  if (!today) return 0;
  let n = 0;
  for (const r of records) {
    if (r.source === 'world') continue; // 野外遭遇は対象外
    if (typeof r.at === 'string' && jstDayKey(r.at) === today) n++;
  }
  return n;
}

/** 残り挑戦回数 (0 未満にはしない)。 */
export function trialsRemaining(usedToday: number): number {
  return Math.max(0, TRIAL_DAILY_LIMIT - usedToday);
}
