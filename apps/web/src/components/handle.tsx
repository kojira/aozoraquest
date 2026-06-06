/**
 * DID を渡すと handle を表示するコンポーネント。解決中は ... を出す。
 * ポイント表示 (= "kojira.ioポイント" or "kojira.ioP") もこのコンポーネントで
 * 統一する。
 */
import { useHandle } from '@/lib/handle-cache';

export function Handle({ did, prefix, suffix }: { did: string; prefix?: string; suffix?: string }) {
  const handle = useHandle(did);
  return <>{prefix}{handle}{suffix}</>;
}
