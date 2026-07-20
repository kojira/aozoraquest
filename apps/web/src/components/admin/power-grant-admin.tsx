import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { bumpPower, loadPointsState, type PointsState } from '@/lib/points';

/** 管理者用 (dev): テスト用にあおぞらパワーを付与する。管理ダッシュボード (#417) に集約
 *  (以前は精霊ページ)。加算は残高に純増する salePowerEarned に乗せる (viaPosts は召喚進捗
 *  ゲージ・toSummon も動かす別セマンティクスなので、残高だけ盛る用途では使わない)。 */
export function PowerGrantAdmin({ agent, did }: { agent: Agent; did: string }) {
  const [points, setPoints] = useState<PointsState | null>(null);
  const [granting, setGranting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPointsState(agent, did)
      .then((p) => { if (!cancelled) setPoints(p); })
      .catch((e) => console.warn('points load failed', e));
    return () => { cancelled = true; };
  }, [agent, did]);

  const grant = async (n: number) => {
    setGranting(true);
    try {
      await bumpPower(agent, did, { salePowerEarned: n });
      const next = await loadPointsState(agent, did);
      setPoints(next);
    } catch (e) {
      console.warn('admin power grant failed', e);
    } finally {
      setGranting(false);
    }
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>パワー付与 (テスト)</h3>
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
