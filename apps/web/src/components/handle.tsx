/**
 * DID を渡すと handle を表示するコンポーネント。
 *  - loading 中は「...」
 *  - resolved で handle 表示
 *  - deleted (= getProfile が失敗 = アカウント削除等) は「(削除済み)」をグレーで
 *
 * docs/15-user-quest.md 決定事項「発行者アカウント削除時 → グレー表示」に対応。
 */
import { useHandle } from '@/lib/handle-cache';

interface Props {
  did: string;
  /** handle の前に表示する文字 (例: '@') */
  prefix?: string;
  /** handle の後に表示する文字 (例: 'P', 'ポイント') */
  suffix?: string;
}

export function Handle({ did, prefix, suffix }: Props) {
  const { handle, state } = useHandle(did);

  if (state === 'deleted') {
    return (
      <span style={{ color: 'var(--color-muted)', opacity: 0.7 }} title="アカウントが削除されています">
        {prefix}(削除済み){suffix}
      </span>
    );
  }
  if (state === 'loading' || !handle) {
    return <span style={{ opacity: 0.6 }}>{prefix}...{suffix}</span>;
  }
  return <>{prefix}{handle}{suffix}</>;
}
