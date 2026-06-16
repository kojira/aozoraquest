/**
 * テーマ (ライト/ダーク) の適用。font-scale.ts と同じ流儀で、ユーザー設定
 * (prefs の getTheme) を読んで `<html data-theme="light|dark">` に反映する。
 *
 * - 選択肢は 'system' | 'light' | 'dark' (既定 'system')。
 * - 'system' のときは OS の prefers-color-scheme に追従し、変化も監視する。
 * - CSS 側は :root[data-theme="light"] で明色トークンを上書きする
 *   (ダークが :root の既定値)。data-theme は常に解決後の 'light'|'dark' を入れる。
 */
import { getTheme, setTheme, type ThemeChoice } from './prefs';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** 選択を実効テーマ ('light'|'dark') に解決する。 */
export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

/** 実効テーマを html[data-theme] に反映する。 */
function applyResolved(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(choice));
}

let mql: MediaQueryList | null = null;
let mqlListener: ((e: MediaQueryListEvent) => void) | null = null;

/** ユーザーがテーマを変更したときに呼ぶ。保存 + 即時反映 + system 監視の張り直し。 */
export function applyTheme(choice: ThemeChoice): void {
  setTheme(choice);
  applyResolved(choice);
  // 'system' のときだけ OS のテーマ変化を監視して追従する。
  if (mql && mqlListener) mql.removeEventListener('change', mqlListener);
  mql = null;
  mqlListener = null;
  if (choice === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mqlListener = () => applyResolved('system');
    mql.addEventListener('change', mqlListener);
  }
}

/** 起動時に保存済みテーマを適用する (main.tsx から呼ぶ)。 */
export function initTheme(): void {
  applyTheme(getTheme());
}
