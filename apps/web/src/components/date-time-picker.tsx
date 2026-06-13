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
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  id,
  ariaLabel = '日時を選択',
  defaultTime = { hh: 23, mm: 59 },
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

  // value が外部 / クリアで変わったら表示月も追従 (選択日の月へ)
  useEffect(() => {
    if (parsed) setView({ year: parsed.y, month1: parsed.m });
    // parsed は value 由来。value の変化のみ監視。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // パネル外クリック / Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  function setTime(hh: number, mm: number) {
    // 日付未選択なら表示中の月の「今日 or 1日」に時刻を乗せる
    const base = parsed ?? {
      y: view.year,
      m: view.month1,
      d:
        view.year === today.getFullYear() && view.month1 === today.getMonth() + 1
          ? today.getDate()
          : 1,
    };
    onChange(formatLocal(base.y, base.m, base.d, hh, mm));
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

          <div className="dtp-grid" role="grid">
            {cells.map((day, i) => {
              if (day === null) return <span key={`e${i}`} className="dtp-day empty" aria-hidden />;
              const selected = isSelectedMonth && parsed!.d === day;
              const isToday = isThisMonth && today.getDate() === day;
              const dow = (firstWeekday + day - 1) % 7;
              return (
                <button
                  type="button"
                  key={day}
                  className={`dtp-day${selected ? ' selected' : ''}${isToday ? ' today' : ''}${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}`}
                  aria-pressed={selected}
                  aria-label={`${view.year}年${view.month1}月${day}日`}
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
              value={parsed ? parsed.mm : defaultTime.mm}
              onChange={(e) => setTime(parsed ? parsed.hh : defaultTime.hh, Number(e.target.value))}
            >
              {/* 5 分刻み + 現在値が刻みから外れていても表示できるよう補完 */}
              {minuteOptions(parsed?.mm).map((mm) => (
                <option key={mm} value={mm}>{pad(mm)}</option>
              ))}
            </select>
          </div>

          <div className="dtp-actions">
            <button type="button" className="secondary dtp-clear" onClick={clear}>クリア</button>
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
