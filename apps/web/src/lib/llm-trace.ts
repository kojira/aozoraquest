/**
 * iOS Safari の Web プロセスが OOM kill されると console ログは残らないので、
 * クラッシュ前の進行情報を localStorage に追記しておく。クラッシュ後リロードした
 * ページで前回トレースを画面表示できる。
 *
 * - LLM 関連のステップ (worker 起動 / pipeline 進捗 / 失敗) を保存
 * - 1 セッションが終わる (`finalize` 呼び出し) と「最後の trace」として `last` に
 *   コピーし、`current` をクリア。次回リロードでは `last` を読む
 */

const KEY_CURRENT = 'aozoraquest:llm-trace:current';
const KEY_LAST = 'aozoraquest:llm-trace:last';
const MAX_ENTRIES = 200;

interface TraceEntry {
  /** ms since session start */
  t: number;
  msg: string;
}

function safeParse(raw: string | null): TraceEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as TraceEntry[]) : [];
  } catch {
    return [];
  }
}

let sessionStart = 0;

function ensureStarted() {
  if (sessionStart === 0) sessionStart = Date.now();
}

export function appendLlmTrace(msg: string) {
  if (typeof localStorage === 'undefined') return;
  ensureStarted();
  try {
    const entries = safeParse(localStorage.getItem(KEY_CURRENT));
    entries.push({ t: Date.now() - sessionStart, msg });
    // ringbuffer
    const trimmed = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
    localStorage.setItem(KEY_CURRENT, JSON.stringify(trimmed));
  } catch {
    // localStorage quota etc.
  }
}

/** セッション完了 (儀式 done / 明示クリア時など) を記録。current を last に格上げ。 */
export function finalizeLlmTrace() {
  if (typeof localStorage === 'undefined') return;
  try {
    const cur = localStorage.getItem(KEY_CURRENT);
    if (cur) localStorage.setItem(KEY_LAST, cur);
    localStorage.removeItem(KEY_CURRENT);
    sessionStart = 0;
  } catch {
    // ignore
  }
}

/** 前回未終了 (current) があればそれを優先。無ければ last。 */
export function readLlmTrace(): TraceEntry[] {
  if (typeof localStorage === 'undefined') return [];
  const cur = safeParse(localStorage.getItem(KEY_CURRENT));
  if (cur.length > 0) return cur;
  return safeParse(localStorage.getItem(KEY_LAST));
}

export function clearLlmTrace() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY_CURRENT);
    localStorage.removeItem(KEY_LAST);
    sessionStart = 0;
  } catch {
    // ignore
  }
}
