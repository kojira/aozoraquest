/**
 * ローカル日時文字列 (`YYYY-MM-DDTHH:mm`) のパース / 整形ヘルパー。
 *
 * このフォーマットは `<input type="datetime-local">` の value と同形で、
 * `new Date(value)` がローカルタイムとして解釈する。DateTimePicker は
 * これを emit するので、既存の `new Date(deadline).toISOString()` 系の
 * 呼び出しを一切変えずに置き換えられる。
 */

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

export interface LocalDateTime {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` をパース。空文字 / 不正 / 実在しない日付なら null。 */
export function parseLocal(v: string): LocalDateTime | null {
  // 秒は許容して切り捨てるが、末尾の無関係な文字列や TZ 指定は弾く
  // (TZ 付き ISO はローカルとして誤解釈しないよう null にする。value は常にローカル形式)
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(v);
  if (!match) return null;
  const parsed: LocalDateTime = {
    y: Number(match[1]),
    m: Number(match[2]),
    d: Number(match[3]),
    hh: Number(match[4]),
    mm: Number(match[5]),
  };
  if (parsed.m < 1 || parsed.m > 12) return null;
  if (parsed.hh > 23 || parsed.mm > 59) return null;
  // 実在日付か検証 (2026-02-31 のような壊れ値を弾く)
  const probe = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.hh, parsed.mm);
  if (probe.getMonth() !== parsed.m - 1 || probe.getDate() !== parsed.d) return null;
  return parsed;
}

/** `YYYY-MM-DDTHH:mm` を組み立てる。 */
export function formatLocal(y: number, m: number, d: number, hh: number, mm: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
}

/** 「2026年6月20日 (土) 23:59」のような表示用文字列。 */
export function formatDisplay(p: LocalDateTime): string {
  const w = WEEKDAYS_JA[new Date(p.y, p.m - 1, p.d).getDay()];
  return `${p.y}年${p.m}月${p.d}日 (${w}) ${pad2(p.hh)}:${pad2(p.mm)}`;
}

/** その月の日数 (month1 は 1-12)。 */
export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/**
 * ISO 文字列 (PDS 保存値) を datetime-local 形式のローカル文字列
 * `YYYY-MM-DDTHH:mm` に変換する。DateTimePicker / datetime-local の
 * value としてそのまま使える (ローカルタイムで表示・編集)。
 */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatLocal(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
  );
}

/** 5 分刻みの分の選択肢。current が刻み外 (例 59) なら昇順で混ぜる。 */
export function minuteOptions(current?: number): number[] {
  const base: number[] = [];
  for (let m = 0; m < 60; m += 5) base.push(m);
  if (current !== undefined && current >= 0 && current <= 59 && !base.includes(current)) {
    base.push(current);
    base.sort((a, b) => a - b);
  }
  return base;
}
