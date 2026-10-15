import { useRef } from 'react';

/** 毎レンダーで最新値を写す ref。deps の狭い callback / イベントハンドラから、
 *  再生成を待たずに最新の state を読むために使う (state と ref の二重宣言をまとめる)。 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
