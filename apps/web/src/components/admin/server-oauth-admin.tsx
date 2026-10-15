import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { startServerOAuth, getServerOAuthStatus, type ServerOAuthStatus } from '@/lib/server-oauth';

/** 管理者専用: サーバーアカウント (権威 state の持ち主) の OAuth 連携を開始する。docs/21 §12。
 *  管理ダッシュボード (#417) に集約 (以前は設定ページ)。 */
export function ServerOAuthAdmin({ agent }: { agent: Agent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<ServerOAuthStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState(false);

  // 認可 callback から ?serverOAuth=linked で戻ってきたら「連携できました」を出し、param を掃除する。
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('serverOAuth') === 'linked') {
      setJustLinked(true);
      p.delete('serverOAuth');
      const q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }, []);

  // 連携状態を確認して表示する (以前は状態が画面に出ず「連携できたか分からない」だった)。
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setStatusErr(null);
    getServerOAuthStatus(agent)
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch((e) => { if (!cancelled) setStatusErr(e instanceof Error ? e.message : '状態取得に失敗しました'); });
    return () => { cancelled = true; };
  }, [agent]);

  const onLink = async () => {
    setBusy(true);
    setErr(null);
    try {
      await startServerOAuth(agent); // 成功時は認可サーバーへ遷移する
    } catch (e) {
      setErr(e instanceof Error ? e.message : '連携に失敗しました');
      setBusy(false);
    }
  };

  const fmt = (sec?: number) => (sec ? new Date(sec * 1000).toLocaleString('ja-JP') : '—');
  const expired = status?.linked && status.expiresAt !== undefined && status.expiresAt * 1000 < Date.now();

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>サーバー連携</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        ゲームの権威データを書き込むサーバーアカウントの連携。
      </p>
      {justLinked && (
        <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', marginBottom: '0.5em' }}>連携できました ✅</p>
      )}
      {/* 連携状態 */}
      <div style={{ fontSize: '0.8em', marginBottom: '0.6em' }}>
        {statusErr ? (
          <span style={{ color: 'var(--color-muted)' }}>状態を確認できません: {statusErr}</span>
        ) : status === null ? (
          <span style={{ color: 'var(--color-muted)' }}>状態を確認中…</span>
        ) : status.linked ? (
          <span style={{ color: expired ? 'var(--color-danger, crimson)' : 'var(--color-accent)' }}>
            {expired ? '⚠ 連携済み (アクセストークン失効・cron 更新待ち)' : '✓ 連携済み'}
            {status.did ? <span style={{ color: 'var(--color-muted)' }}> ({status.did})</span> : null}
            <br />
            <span style={{ color: 'var(--color-muted)' }}>
              トークン失効: {fmt(status.expiresAt)} / 最終更新: {fmt(status.updatedAt)}
            </span>
          </span>
        ) : (
          <span style={{ color: 'var(--color-muted)' }}>未連携</span>
        )}
      </div>
      <button onClick={onLink} disabled={busy}>
        {busy ? '連携中…' : status?.linked ? '再連携する' : 'サーバーアカウントと連携'}
      </button>
      {err && <p style={{ fontSize: '0.8em', color: 'var(--color-danger, crimson)', marginTop: '0.4em' }}>{err}</p>}
    </section>
  );
}
