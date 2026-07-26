import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { serverPdsUsage, type ServerPdsUsage } from '@/lib/world-server';

/**
 * **PDS の書き込みレート消費**を管理者に見せる (#548)。
 *
 * 権威 state は全ユーザーが 1 つのサーバーアカウント repo を共有している (docs/21 §9-1)。
 * Bluesky の書き込み上限は DID ごと **5,000 points/時 ・ 35,000 points/日**で、
 * `putRecord` は 1 回 2 points。つまり**全ユーザー合計で 1 時間 2,500 操作 / 1 日 17,500 操作**が
 * 天井になる。「1 操作」は 移動 (街に入るとき) / 戦闘 1 ターン / しらべる / 購入 / 投稿の申告。
 *
 * **PDS 分割の潮時を判断するための画面。** 近づいたことに気づく手段が無かったので作った。
 * 読み取りは書き込み点数を消費しないので、何度開いても天井には効かない。
 */
export function PdsUsageAdmin({ agent }: { agent: Agent }) {
  const [data, setData] = useState<ServerPdsUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await serverPdsUsage(agent));
    } catch (e) {
      console.warn('pds usage load failed', e);
      setErr('取得できなかった (コンソール参照)');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent]);

  const u = data?.usage ?? null;
  const pct = u && u.limit && u.remaining !== null ? Math.round((1 - u.remaining / u.limit) * 100) : null;
  // 逼迫の目安。8 割を超えたら分割の検討に入る (残り 2 割は日内の波で簡単に飛ぶ)。
  const tight = pct !== null && pct >= 80;

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>PDS の書き込み残量</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        権威データは全ユーザーが 1 つのサーバーアカウントを共有している。ここが天井に近づいたら
        <strong> PDS を分割する</strong>。1 操作 = {data?.pointsPerOp ?? 2} points
        (移動 / 戦闘 1 ターン / しらべる / 購入 / 投稿の申告)。
      </p>

      {err && <p style={{ fontSize: '0.85em', color: 'var(--color-danger, #e8566a)' }}>{err}</p>}

      {u ? (
        <div className="dq-window" style={{ padding: '0.6em 0.8em', fontSize: '0.85em', lineHeight: 1.8 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace' }}>
            のこり{' '}
            <strong style={{ color: tight ? 'var(--color-danger, #e8566a)' : 'var(--color-accent)' }}>
              {u.remaining?.toLocaleString() ?? '—'}
            </strong>
            {u.limit !== null && <> / {u.limit.toLocaleString()} points</>}
            {pct !== null && <>（{pct}% 使用）</>}
          </div>
          <div>
            あと <strong>{data?.opsRemaining?.toLocaleString() ?? '—'}</strong> 操作ぶん
            {u.reset !== null && <>・{new Date(u.reset * 1000).toLocaleTimeString()} にリセット</>}
          </div>
          <div style={{ color: 'var(--color-muted)', fontSize: '0.92em' }}>
            方式 {u.policy ?? '—'} ・ 観測した書き込み {u.writes.toLocaleString()} 回 ・
            最終観測 {new Date(u.at * 1000).toLocaleString()}
          </div>
          {tight && (
            <div style={{ marginTop: '0.4em', color: 'var(--color-danger, #e8566a)' }}>
              8 割を超えた。PDS 分割 (ユーザーごと / シャード) の検討に入る頃合い。
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          {busy ? '取得中…' : 'まだ書き込みが 1 度も無い (計測はサーバーが書いたときに更新される)。'}
        </p>
      )}

      <div style={{ marginTop: '0.5em' }}>
        <button onClick={() => void load()} disabled={busy}>{busy ? '取得中…' : '再取得'}</button>
      </div>
    </section>
  );
}
