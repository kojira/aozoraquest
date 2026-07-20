import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { resetOnboarding, armOnboardingReplay } from '@/lib/onboarding-reset';

/**
 * 管理者専用 (dev のみ): あおぞらワールドを「はじめから」やり直す完全ワイプ。
 * 管理ダッシュボード (#417) に集約 (以前は設定ページ)。
 *
 * **リセットするだけ**で遷移はしない (この画面に留まる — オーナー指摘 2026-07-20)。
 * armOnboardingReplay でイントロ再表示フラグと祝福マークを storage に立てておくので、管理者が
 * 自分で通常どおり精霊ブルスコン→「冒険する」→ワールドと進めば、新規ユーザーと同じ
 * 「ブルスコン画面→冒険する→イントロ→手渡し→祝福」を頭から辿れる。
 */
export function WorldResetAdmin({ agent, did }: { agent: Agent; did: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 成功表示は数秒で自然に消す (この画面に留まって他操作を続けても居座らせない — レビュー ★★)。
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 6000);
    return () => window.clearTimeout(t);
  }, [done]);

  const onReset = async () => {
    if (busy) return;
    // 前回の成功/失敗メッセージはボタンを押した時点で消す (confirm でキャンセルしても残像を残さない)。
    setErr(null);
    setDone(false);
    if (!window.confirm('あおぞらワールドを「はじめから」やり直します。\n所持品・装備・レベル・位置がすべて初期化され、元に戻せません (投稿で貯めたパワー残高は残ります)。よろしいですか?')) return;
    setBusy(true);
    let timeoutId: number | undefined;
    try {
      // 30s の全体タイムアウト (PDS 無応答でも「リセット中…」で固着しない fail-safe)。
      await Promise.race([
        resetOnboarding(agent, did),
        new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error('reset timeout')), 30_000); }),
      ]);
      // 次に管理者が自分でワールドへ入ったとき新規と同じ導入を再生するための準備 (イントロ再表示 +
      // 祝福マーク)。ここでは遷移しない (オーナー指摘 2026-07-20)。
      armOnboardingReplay();
      setDone(true);
    } catch (e) {
      console.warn('[admin] onboarding reset failed', e);
      const detail = e instanceof Error ? e.message : '';
      setErr(`リセットに失敗しました (${detail || '通信エラー'})。もう一度どうぞ。`);
    } finally {
      setBusy(false);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>ワールドリセット</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        ワールドを「はじめから」やり直す。所持品・装備・レベル・位置を初期化 (投稿で貯めたパワー
        残高は残る)。リセット後、精霊ブルスコンの画面から冒険すると新規と同じ導入を辿れる。
      </p>
      <button onClick={onReset} disabled={busy}>
        {busy ? 'リセット中…' : '⟲ あおぞらワールドを はじめから'}
      </button>
      {/* 重い I/O (最大 30s) 中は「固まった?」に見えないよう明滅で処理継続を示す。 */}
      {busy && (
        <p aria-live="polite" style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '0.4em' }}>
          <style>{'@keyframes reset-pulse{0%,100%{opacity:0.4}50%{opacity:1}}'}</style>
          <span style={{ animation: 'reset-pulse 1.4s ease-in-out infinite' }}>はじめの地へ もどしています…</span>
        </p>
      )}
      {done && !busy && (
        <p aria-live="polite" style={{ fontSize: '0.8em', color: 'var(--color-accent)', marginTop: '0.4em' }}>
          はじめの地へ もどりました。精霊ブルスコンから 冒険できます。
        </p>
      )}
      {err && <p style={{ fontSize: '0.8em', color: 'var(--color-danger, crimson)', marginTop: '0.4em' }}>{err}</p>}
    </section>
  );
}
