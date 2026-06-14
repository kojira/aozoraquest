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
      <span style={{ color: 'var(--color-muted)', opacity: 0.7 }} title="このアカウントは削除されています">
        {prefix}(削除済み){suffix}
      </span>
    );
  }
  if (state === 'transient') {
    return (
      <span style={{ color: 'var(--color-muted)' }} title="アカウント情報の取得に失敗しました (一時的な可能性)">
        {prefix}???{suffix}
      </span>
    );
  }
  if (state === 'loading' || !handle) {
    // min-width で CLS を抑える (= ... → handle 切替時にレイアウトがガタつくのを避ける)
    return <span style={{ opacity: 0.6, display: 'inline-block', minWidth: '4em' }}>{prefix}…{suffix}</span>;
  }
  return <>{prefix}{handle}{suffix}</>;
}

/**
 * 報酬ポイント表記。「kojira.ioP777」だと読みづらいので
 * 「kojira.io P 777」と区切り、「P」を太字の白で浮かせる
 * (DESIGN.md: 強調は白)。handle 部分は親の色を踏襲する。
 */
export function RewardPoints({ did, points }: { did: string; points: number }) {
  return (
    <>
      <Handle did={did} />{' '}
      <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>P</span>{' '}
      {points.toLocaleString()}
    </>
  );
}
