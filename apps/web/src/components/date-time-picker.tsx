/**
 * DQ ウィンドウ様式のカレンダー日時ピッカー (DESIGN.md 準拠)。
 *
 * 募集期限のような日時入力に使う。OS ごとに見た目が違う
 * `<input type="datetime-local">` を置き換え、aozoraquest の世界観に
 * 揃った月グリッド + 時刻選択を提供する。
 *
 * 値のフォーマットは datetime-local と同じローカル文字列
 * `YYYY-MM-DDTHH:mm` (= `new Date(value)` でそのまま解釈できる)。
 * これにより既存の `new Date(deadline).toISOString()` 系ロジックを
 * 一切変えずに drop-in 置換できる。空文字 = 未設定。
 *
 * パネルは絶対配置ではなくインライン展開 (アコーディオン) にしている。
 * workspace のカラムスクローラや board-detail の dq-window の中でも
 * クリップされず確実に開けるため。
 */
import { useEffect, useId, useRef, useState } from 'react';
import {
  WEEKDAYS_JA as WEEKDAYS,
  parseLocal,
  formatLocal,
  formatDisplay,
  daysInMonth,
  minuteOptions,
} from '@/lib/datetime';

const pad = (n: number) => String(n).padStart(2, '0');

export interface DateTimePickerProps {
  /** ローカル日時文字列 `YYYY-MM-DDTHH:mm`、または '' で未設定 */
  value: string;
  onChange: (value: string) => void;
  /** trigger に付ける id (label htmlFor 連携用) */
  id?: string;
  ariaLabel?: string;
  /** 初回に日付を選んだときのデフォルト時刻 (省略時 23:59 = 締切らしい終端) */
  defaultTime?: { hh: number; mm: number };
  /** 過去日を選べなくする (省略時 true)。締切用途では過去日を弾く。 */
  disablePast?: boolean;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  id,
  ariaLabel = '日時を選択',
  defaultTime = { hh: 23, mm: 59 },
  disablePast = true,
  className,
}: DateTimePickerProps) {
  const reactId = useId();
  const triggerId = id ?? `dtp-${reactId}`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const parsed = parseLocal(value);

  // 表示中の月 (year, month1)。value があればその月、なければ今日。
  const today = new Date();
  const [view, setView] = useState<{ year: number; month1: number }>(() =>
    parsed
      ? { year: parsed.y, month1: parsed.m }
      : { year: today.getFullYear(), month1: today.getMonth() + 1 },
  );

  // value の「月」が変わったときだけ表示月を追従する。
  // 時刻だけ変更 (= 月は同じ) では view を動かさない
  // (ユーザーが別の月を眺めている最中に巻き戻さないため)。
  const lastSyncedMonth = useRef<string | null>(parsed ? `${parsed.y}-${parsed.m}` : null);
  useEffect(() => {
    const p = parseLocal(value);
    const key = p ? `${p.y}-${p.m}` : null;
    if (key && key !== lastSyncedMonth.current) {
      setView({ year: p!.y, month1: p!.m });
    }
    lastSyncedMonth.current = key;
  }, [value]);

  // パネル外クリック / Esc で閉じる。
  // ネイティブ <select> の操作中 (focus がパネル内) は閉じない
  // (モバイルでネイティブピッカーのオーバーレイを触ると mousedown が
  //  ルート外と判定され、時刻選択中にパネルが消える事故を防ぐ)。
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      if (document.activeElement && root.contains(document.activeElement)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function selectDay(day: number) {
    const hh = parsed ? parsed.hh : defaultTime.hh;
    const mm = parsed ? parsed.mm : defaultTime.mm;
    onChange(formatLocal(view.year, view.month1, day, hh, mm));
  }

  // 時刻 select は「日付を選んでから」のみ有効 (parsed があるとき)。
  // 日付未選択で時刻だけ触っても勝手に日付が確定しないようにする。
  function setTime(hh: number, mm: number) {
    if (!parsed) return;
    onChange(formatLocal(parsed.y, parsed.m, parsed.d, hh, mm));
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = new Date(v.year, v.month1 - 1 + delta, 1);
      return { year: next.getFullYear(), month1: next.getMonth() + 1 };
    });
  }

  function clear() {
    onChange('');
    setView({ year: today.getFullYear(), month1: today.getMonth() + 1 });
  }

  // グリッド生成: 先頭の空セル (月初の曜日) + 各日
  const firstWeekday = new Date(view.year, view.month1 - 1, 1).getDay();
  const dim = daysInMonth(view.year, view.month1);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);

  const isSelectedMonth = !!parsed && parsed.y === view.year && parsed.m === view.month1;
  const isThisMonth = today.getFullYear() === view.year && today.getMonth() + 1 === view.month1;
  // 表示月が今日より前か (= 月まるごと過去か) の判定に使う
  const todayDay = today.getDate();
  const viewBeforeToday =
    view.year < today.getFullYear() ||
    (view.year === today.getFullYear() && view.month1 < today.getMonth() + 1);

  function isPast(day: number): boolean {
    if (!disablePast) return false;
    if (viewBeforeToday) return true;
    if (isThisMonth) return day < todayDay;
    return false;
  }

  return (
    <div className={`dtp${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className="dtp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarIcon />
        <span className={`dtp-trigger-text${parsed ? '' : ' is-empty'}`}>
          {parsed ? formatDisplay(parsed) : '未設定'}
        </span>
        <span className="dtp-caret" aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="dtp-panel dq-window compact" role="dialog" aria-label={ariaLabel}>
          <div className="dtp-cal-head">
            <button type="button" className="dtp-nav" aria-label="前の月" onClick={() => shiftMonth(-1)}>‹</button>
            <span className="dtp-cal-title">{view.year}年 {view.month1}月</span>
            <button type="button" className="dtp-nav" aria-label="次の月" onClick={() => shiftMonth(1)}>›</button>
          </div>

          <div className="dtp-grid dtp-weekrow" aria-hidden>
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={`dtp-weekday${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{w}</span>
            ))}
          </div>

          <div className="dtp-grid">
            {cells.map((day, i) => {
              if (day === null) return <span key={`e${i}`} className="dtp-day empty" aria-hidden />;
              const selected = isSelectedMonth && parsed!.d === day;
              const isToday = isThisMonth && todayDay === day;
              const past = isPast(day);
              const dow = (firstWeekday + day - 1) % 7;
              return (
                <button
                  type="button"
                  key={day}
                  className={`dtp-day${selected ? ' selected' : ''}${isToday ? ' today' : ''}${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`}
                  aria-pressed={selected}
                  aria-label={`${view.year}年${view.month1}月${day}日`}
                  disabled={past}
                  onClick={() => selectDay(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="dtp-time">
            <label className="dtp-time-label">時刻</label>
            <select
              aria-label="時"
              disabled={!parsed}
              value={parsed ? parsed.hh : defaultTime.hh}
              onChange={(e) => setTime(Number(e.target.value), parsed ? parsed.mm : defaultTime.mm)}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span className="dtp-colon">:</span>
            <select
              aria-label="分"
              disabled={!parsed}
              value={parsed ? parsed.mm : defaultTime.mm}
              onChange={(e) => setTime(parsed ? parsed.hh : defaultTime.hh, Number(e.target.value))}
            >
              {/* 5 分刻み + 現在値が刻みから外れていても表示できるよう補完 */}
              {minuteOptions(parsed?.mm).map((mm) => (
                <option key={mm} value={mm}>{pad(mm)}</option>
              ))}
            </select>
            {!parsed && <span className="dtp-time-hint">日付を選ぶと指定できます</span>}
          </div>

          <div className="dtp-actions">
            <button type="button" className="secondary dtp-clear" onClick={clear} disabled={!parsed}>
              未設定に戻す
            </button>
            <button type="button" onClick={() => setOpen(false)}>決定</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg className="dtp-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M1.5 6H14.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 1V3.5M11 1V3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
