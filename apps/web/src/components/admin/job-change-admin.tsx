import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { ARCHETYPES, jobDisplayName, jobLevelFromXp, type Archetype, type DiagnosisResult } from '@aozoraquest/core';
import { COL } from '@/lib/collections';
import { serverAdminSetJobLevel } from '@/lib/world-server';
import { loadJobXp, refreshJobXp, xpOfJob } from '@/lib/use-job-xp';
import { getRecord } from '@/lib/atproto';
import { adminSetJob } from '@/lib/post-processor';

/**
 * 管理者用 (dev): 自分のジョブ (archetype) と現職レベルを即座に切り替える。
 * 各ジョブのキット / Lv30 パッシブを実プレイで確かめる用途 (#456)。
 *
 * confirmJobChange と同じく**本人の PDS (analysis/self) を本人トークンで書く**ので、サーバー権威の
 * 詐称にならない (通常プレイヤーも再診断で自分の archetype を書き換える)。表示ゲートは admin-dashboard
 * の `WORLD_PREVIEW_ENABLED && isAdminDid`。**次の戦闘から新ジョブが適用される** (edge は戦闘開始時に
 * analysis の archetype を読んでガードに封じるため、進行中の戦闘は旧ジョブのまま・切替後に新ジョブで
 * 戦うには一度戦闘を終える)。
 */
export function JobChangeAdmin({ agent, did }: { agent: Agent; did: string }) {
  const [current, setCurrent] = useState<{ archetype: Archetype; jobLevel: number } | null>(null);
  const [pick, setPick] = useState<Archetype>('warrior');
  const [level, setLevel] = useState(30); // 既定 30 = Lv30 パッシブをすぐ試せる
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 職は analysis (診断の結果) / LV は権威 state (#534) — 出所が違うので両方読む。
    Promise.all([
      getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self'),
      loadJobXp(agent, did),
    ])
      .then(([a, xpMap]) => {
        if (cancelled || !a) return;
        const jl = jobLevelFromXp(xpOfJob(xpMap, a.archetype), a.archetype);
        setCurrent({ archetype: a.archetype, jobLevel: jl });
        setPick(a.archetype);
      })
      .catch((e) => console.warn('admin job load failed', e));
    return () => { cancelled = true; };
  }, [agent, did]);

  const apply = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // 職は analysis を書き換え、LV は権威 state に書く (#534)。
      // analysis 側だけ書いてもレベルは動かない (XP の記録先が一本化されたため)。
      const next = await adminSetJob(agent, did, pick, level);
      if (!next) { setMsg('診断レコードが無い (先に診断が要る)'); return; }
      const set = await serverAdminSetJobLevel(agent, pick, level);
      await refreshJobXp(agent, did);
      setCurrent({ archetype: next.archetype, jobLevel: set.level });
      setMsg(`${jobDisplayName(next.archetype)} Lv${set.level} に変更 (戦闘中なら次戦から)`);
    } catch (e) {
      console.warn('admin job change failed', e);
      setMsg('変更に失敗した (コンソール参照)');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>ジョブ変更 (自分・テスト)</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.5em' }}>
        自分のジョブとレベルを即切替 (キット / Lv30 パッシブ確認用)。次の戦闘から反映。
        {current && <> 現在: <b>{jobDisplayName(current.archetype)}</b> Lv{current.jobLevel}</>}
      </p>
      <div style={{ display: 'inline-flex', gap: '0.5em', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85em' }}>
        <select value={pick} onChange={(e) => setPick(e.target.value as Archetype)} disabled={busy}>
          {ARCHETYPES.map((a) => (<option key={a} value={a}>{jobDisplayName(a)}</option>))}
        </select>
        <label>
          Lv
          <input
            type="number"
            min={1}
            max={50}
            value={level}
            onChange={(e) => { const n = Number(e.target.value); setLevel(Number.isFinite(n) ? n : 1); }}
            disabled={busy}
            style={{ width: '3.5em', marginLeft: '0.3em' }}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void apply()} style={{ padding: '0.2em 0.7em' }}>
          {busy ? '変更中…' : 'このジョブに変更'}
        </button>
        {msg && <span style={{ color: 'var(--color-muted)' }}>{msg}</span>}
      </div>
    </section>
  );
}
