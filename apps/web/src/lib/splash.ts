/**
 * index.html の即時スプラッシュ (#app-splash) を滑らかにフェードして除去する。
 *
 * 呼ぶタイミングは「アプリが実際に表示できる状態になったとき」(= session.status が
 * loading を抜けたとき、AppShell から)。これで JS パース + セッション復元の間ずっと
 * 1 枚のスプラッシュが出続け、「準備しています…」のちらつき (二重ローディング) を避ける。
 * main.tsx はハング保険として最大待ち時間後に強制除去する。二重呼び出しは data 属性でガード。
 */
export function removeSplash(): void {
  const el = document.getElementById('app-splash');
  if (!el || el.dataset.removing) return;
  el.dataset.removing = '1';
  el.style.transition = 'opacity 0.32s ease';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  window.setTimeout(() => el.remove(), 340);
}
