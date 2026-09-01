import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { useRuntimeConfig } from '@/components/config-provider';
import { isUnderMaintenance } from '@/lib/runtime-config';

/**
 * **メンテナンスモードはアプリ全体を止める** (#561)。app-shell が全ルートをこれで包む。
 *
 * 誰を通すかは `isUnderMaintenance` (runtime-config) が 1 か所で決める — 管理者と
 * `allowedDids` は通る、未ログイン (セッション復元中を含む) は止まる。ここでは
 * **どのパスを通すか**だけを持つ:
 *
 * - `/admin` 配下: 解除の導線。締め出されたときにここだけは入れる保証。
 *   (中身は各画面の `isAdminDid` 表示ゲートに任せる — 一般ユーザーが来ても管理画面は開かない)
 * - `/onboarding` と `/oauth/callback`: ログアウト中の管理者がログインして解除するための経路。
 *   ログインしても管理者でなければ、戻った先でこの画面に止まる。
 */
export function maintenanceExemptPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
    || pathname === '/onboarding' || pathname === '/oauth/callback';
}

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const config = useRuntimeConfig();
  const { pathname } = useLocation();
  if (isUnderMaintenance(config, session.did) && !maintenanceExemptPath(pathname)) {
    return <MaintenanceScreen {...config.maintenance} />;
  }
  return <>{children}</>;
}

const DEFAULT_MESSAGE = 'メンテナンス中です。しばらくお待ちください。';

/** 管理画面で入れた `until` は自由書式なので、日時として読めたときだけ整形する。 */
function formatUntil(until: string): string {
  const t = new Date(until);
  return Number.isNaN(t.getTime()) ? until : t.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}

function MaintenanceScreen({ message, until }: { message?: string | undefined; until?: string | undefined }) {
  return (
    <div role="status" className="dq-window" style={{ margin: '2em auto', maxWidth: '28em', padding: '1.2em 1.4em' }}>
      <h2 style={{ fontSize: '1em', marginTop: 0 }}>メンテナンス中</h2>
      <p style={{ whiteSpace: 'pre-wrap' }}>{message || DEFAULT_MESSAGE}</p>
      {until && (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          終了予定: <time dateTime={until}>{formatUntil(until)}</time>
        </p>
      )}
    </div>
  );
}
