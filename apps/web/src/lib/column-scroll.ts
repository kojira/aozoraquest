/**
 * カラム body のスクロール位置を保存/復元する (sessionStorage)。
 *
 * 投稿詳細やプロフィールは Workspace とは別ルートなので、そこへ遷移すると Workspace が
 * アンマウントされ、戻ると各カラムが再マウントされて先頭に戻ってしまう。仮想リスト
 * (VirtualFeed) は内側コンテナのスクロールなので、ブラウザ標準のスクロール復元も効かない。
 * そこで body の scrollTop を「カラム種別 (+param)」ごとに sessionStorage に控え、戻って
 * 来た時に復元する。key は col.id ではなく kind+param にする (id は再マウントで再生成
 * されるため安定しない)。sessionStorage なのでタブを閉じれば消える。
 */
import type { AppColumn } from './app-columns';

const PREFIX = 'aozoraquest:scroll:';

/** カラムの安定スクロールキー (kind + 主要 param)。 */
export function columnScrollKey(c: AppColumn): string {
  switch (c.kind) {
    case 'home':
      return 'home';
    case 'bar':
      return 'bar';
    case 'notifications':
      return 'notifications';
    case 'board':
      return 'board';
    case 'search':
      return `search:${c.mode ?? ''}:${c.param ?? ''}`;
    case 'profile':
      return `profile:${c.section ?? ''}:${c.param ?? ''}`;
  }
}

export function readColumnScroll(key: string): number {
  try {
    const v = sessionStorage.getItem(PREFIX + key);
    if (v == null) return 0;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeColumnScroll(key: string, top: number): void {
  try {
    if (top > 0) sessionStorage.setItem(PREFIX + key, String(Math.round(top)));
    else sessionStorage.removeItem(PREFIX + key); // 先頭は「保存なし」と同義にして肥大化を防ぐ
  } catch {
    /* no-op */
  }
}
