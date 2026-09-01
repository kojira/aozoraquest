import { useEffect, useRef, useState } from 'react';
import type { Agent } from '@atproto/api';
import { loadAuthoredWorld } from './world-authoring';

/**
 * **管理エディタは保存済みレコードを読み込んでから編集させる** (#603)。
 *
 * 各エディタの初期値はメモリ (`activeMonsters()` 等) から取るが、それが埋まるのは
 * /world か /admin/map を先に開いたときだけ。エディタを URL 直打ち・リロードで開くと
 * 空/コード直書きの状態から編集が始まり、保存すると PDS レコードを丸ごと上書きして
 * 既存の編集が消える。
 *
 * マウント時 (と agent が変わったとき) に `loadAuthoredWorld` を回し、終わるまで
 * `false` を返す。エディタは読み込み完了で `reset` を呼ばれて一覧を現物から取り直し、
 * `false` の間は保存ボタンを無効にする。
 */
export function useAuthoredWorld(agent: Agent | null, reset: () => void): boolean {
  const [loaded, setLoaded] = useState(false);
  // 最新の reset を効果から呼ぶ (deps に入れるとレンダーごとに読み直してしまう)。
  const resetRef = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void loadAuthoredWorld(agent).finally(() => {
      if (cancelled) return;
      resetRef.current();
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [agent]);

  return loaded;
}
