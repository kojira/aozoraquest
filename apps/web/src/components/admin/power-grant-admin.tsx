import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { bumpPower, loadPointsState, type PointsState } from '@/lib/points';
import { serverAdminGrantPower, serverState } from '@/lib/world-server';

/** 管理者用 (dev): テスト用にあおぞらパワーを付与する。管理ダッシュボード (#417) に集約
 *  (以前は精霊ページ)。加算は残高に純増する salePowerEarned に乗せる (viaPosts は召喚進捗
 *  ゲージ・toSummon も動かす別セマンティクスなので、残高だけ盛る用途では使わない)。
 *
 *  **client 側 (PDS の power レコード) と権威 state の両方に付与する。** 以前は client 側
 *  だけを書いており、画面にはパワーがあるのに `GameState.power` が 0 = 勝っても XP も
 *  ドロップも入らない、という見えない失敗になっていた (オーナー報告 2026-07-26)。 */
export function PowerGrantAdmin({ agent, did }: { agent: Agent; did: string }) {
  const [points, setPoints] = useState<PointsState | null>(null);
  const [serverPower, setServerPower] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPointsState(agent, did)
      .then((p) => { if (!cancelled) setPoints(p); })
      .catch((e) => console.warn('points load failed', e));
    serverState(agent)
      .then((s) => { if (!cancelled) setServerPower(s.state.power ?? 0); })
      .catch((e) => console.warn('server power load failed', e));
    return () => { cancelled = true; };
  }, [agent, did]);

  const grant = async (n: number) => {
    setGranting(true);
    try {
      setMsg(null);
      // 権威側を先に。ここが本体 (報酬の可否を決めるのはこちら)。
      const { power } = await serverAdminGrantPower(agent, n);
      setServerPower(power);
      // client 側の表示 (召喚ゲージ等が使う) も合わせる。**ここが落ちても権威側は
      // 既に増えている**ので、まとめて「失敗」と出さない — 出すと管理者が押し直して
      // 権威側だけ二重に増える (本 PR が可視化しようとしたずれを管理画面自身が広げる)。
      try {
        await bumpPower(agent, did, { salePowerEarned: n });
        setPoints(await loadPointsState(agent, did));
        setMsg(`権威・表示とも +${n}`);
      } catch (e) {
        console.warn('client power bump failed', e);
        setMsg(`権威は +${n} 済み。表示側の更新に失敗した (押し直すと権威が二重に増える)`);
      }
    } catch (e) {
      console.warn('admin power grant failed', e);
      setMsg('権威側の付与に失敗した (何も増えていない)');
    } finally {
      setGranting(false);
    }
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>パワー付与 (テスト)</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        テスト用に残高を加算する (召喚ゲージ viaPosts は動かさない)。
        <br />
        <strong>権威 (戦闘の報酬を決める側): {serverPower ?? '—'}</strong>
        {' / '}表示 (クライアント): {points?.balance ?? '—'}
        {msg && <><br />{msg}</>}
      </p>
      <div
        style={{
          display: 'inline-flex',
          gap: '0.5em',
          alignItems: 'center',
          fontSize: '0.85em',
          border: '1px dashed var(--color-muted)',
          borderRadius: 6,
          padding: '0.45em 0.7em',
          color: 'var(--color-muted)',
        }}
      >
        <span>{granting ? '付与中…' : `残高 ${points?.balance ?? '—'}`}</span>
        {[100, 1000].map((n) => (
          <button key={n} type="button" disabled={granting} onClick={() => void grant(n)} style={{ fontSize: '1em', padding: '0.2em 0.6em' }}>
            +{n}
          </button>
        ))}
      </div>
    </section>
  );
}
