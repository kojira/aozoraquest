import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  JOBS,
  JOB_EQUIP_KINDS,
  JOB_STATS_SUM,
  JobDataError,
  MAX_PACE,
  MAX_VIT,
  MIN_PACE,
  MIN_VIT,
  currentJobParams,
  jobOverridesDiff,
  jobDisplayName,
  runAutoBattle,
  setJobOverrides,
  startBattle,
  type Archetype,
  type EquipKind,
  type JobOverride,
  type StatArray,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadJobsRecord, saveJobs } from '@/lib/world-authoring';

/**
 * **ジョブエディタ** (#544)。ステータス比・たいりょく・レベル曲線・装備適性 +
 * **編集値のまま回せる連戦シミュレーション**。
 *
 * バランス調整は「値を変えて試す」を何十回も回す作業なので、保存しなくても
 * 試せることを最優先にしている (試す → 良ければ保存)。
 *
 * とくぎ・パッシブの**効果**はここでは編集できない (関数なので DSL が要る)。
 */

/** 持ち込みやくそうの上限 (連戦の持久力に効く。scripts/sim-endurance と同じ値)。 */
const WORLD_HERB_MAX = 3;

const STAT_LABELS = ['こうげき', 'まもり', 'すばやさ', 'かしこさ', 'うん'] as const;
/** チェックで意味があるカテゴリだけ。**common / cloth / charm は canEquip が
 *  JOB_EQUIP_KINDS を見る前に true を返す**ので、並べても「表示も操作も嘘」になる。 */
const ALL_KINDS: readonly EquipKind[] = ['sword', 'axe', 'shield', 'dagger', 'staff', 'lucky', 'heavy', 'light', 'robe'];

/** 連戦シミュレーション: 街に戻らず何戦もつか (#535 の指標。勝率より職差が見える)。 */
function simulateEndurance(job: Archetype, tier: number, lv: number, trials: number): { avg: number; capped: number } {
  const CAP = 200; // 上限で頭打ちになると強化の効果が読めなくなる (16職×30試行で 0.2 秒程度)
  let total = 0;
  let capped = 0; // 上限で打ち切った試行 (平均が過小評価になっていることの印)
  for (let t = 0; t < trials; t++) {
    let hp: number | undefined;
    let mp: number | undefined;
    let herbs = WORLD_HERB_MAX;
    let battles = 0;
    for (let b = 0; b < CAP; b++) {
      const s = startBattle(
        job, lv, 1, 'sim',
        tier as never,
        t * 977 + b,
        herbs,
        hp !== undefined ? { hp, mp: mp! } : undefined,
      );
      const r = runAutoBattle(s);
      if (r.outcome !== 'win') break;
      battles++;
      hp = r.player.hp;
      mp = r.player.mp;
      herbs = Math.min(WORLD_HERB_MAX, r.herbs ?? 0);
    }
    total += battles;
    if (battles >= CAP) capped++;
  }
  return { avg: total / trials, capped };
}

export function AdminJobs() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<JobOverride[]>(() => currentJobParams());
  const [sel, setSel] = useState<Archetype>(JOBS[0]!.id);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  /** 保存済みレコードを読めたか。**読めていないと保存させない** — コード値のまま
   *  保存すると全職ぶんの調整が消える (レビュー ★★★)。 */
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [tier, setTier] = useState(1);
  const [lv, setLv] = useState(5);
  const [trials, setTrials] = useState(30);
  const [simRows, setSimRows] = useState<Array<{ id: Archetype; avg: number; capped: number }> | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  // 保存済みを読み込んでから編集させる。**読めなければ保存を塞ぐ** (握り潰して
  // コード値を出すと、1 職直して保存した瞬間に他 15 職の調整が消える)。
  useEffect(() => {
    let cancelled = false;
    const agent = session.agent;
    const adminDid = getPrimaryAdminDid();
    if (!agent || !adminDid) { setLoadState('failed'); return; }
    void loadJobsRecord(agent, adminDid)
      .then(() => {
        if (cancelled) return;
        setList(currentJobParams());
        setLoadState('ok');
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[admin] jobs load failed', e);
        setLoadState('failed');
        setNote('保存済みのジョブ設定を読み込めなかった。上書きで消える恐れがあるので保存できない (再読み込みしてほしい)');
      });
    return () => { cancelled = true; };
  }, [session.agent]);

  const current = useMemo(() => list.find((j) => j.id === sel) ?? null, [list, sel]);
  const update = useCallback((id: Archetype, patch: Partial<JobOverride>) => {
    setList((xs) => xs.map((j) => (j.id === id ? { ...j, ...patch } : j)));
    setDirty(true);
  }, []);

  /** 編集値を**保存せずに**適用して試す。終わったら保存済みの状態へ戻す。 */
  const runSim = useCallback(() => {
    setSimBusy(true);
    setNote(null);
    // 同期で回すと画面が固まって見えるので、描画を挟んでから走らせる。
    setTimeout(() => {
      const saved = currentJobParams();
      try {
        setJobOverrides(list);
        const rows = JOBS.map((j) => ({ id: j.id, ...simulateEndurance(j.id, tier, lv, trials) }));
        rows.sort((a, b) => a.avg - b.avg);
        setSimRows(rows);
      } catch (e) {
        setNote(e instanceof JobDataError ? `試せない: ${e.message}` : String(e));
      } finally {
        // **必ず戻す** — 試した値がこの端末に残ると、以後の表示も戦闘も編集中の値で動く。
        setJobOverrides(saved);
        setSimBusy(false);
      }
    }, 0);
  }, [list, tier, lv, trials]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveJobs(session.agent, jobOverridesDiff(list));
      setDirty(false);
      setNote('保存した。サーバーは最大 5 分で拾う');
    } catch (e) {
      setNote(e instanceof JobDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, list]);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

  const statSum = current ? (current.stats ?? [0, 0, 0, 0, 0]).reduce((a, b) => a + b, 0) : 0;
  const field = (label: string, input: React.ReactNode) => (
    <label className="admin-field">
      <span>{label}</span>
      {input}
    </label>
  );

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>ジョブ</strong>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || loadState !== 'ok'} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => setSel(j.id)}
              style={{
                display: 'flex', gap: '0.4em', width: '100%', padding: '0.2em 0.4em',
                fontSize: '0.85em', textAlign: 'left',
                border: sel === j.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{jobDisplayName(j.id, 'default')}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>体{j.vit} 曲{j.pace?.toFixed(2)}</span>
            </button>
          ))}
        </div>

        {current && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            <strong>{jobDisplayName(current.id, 'default')}</strong>
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>ステータス比 (合計 {JOB_STATS_SUM})</span>
              {STAT_LABELS.map((label, i) => (
                <div key={label} style={{ display: 'flex', gap: '0.4em', alignItems: 'center', margin: '0.1em 0' }}>
                  <span style={{ width: '5em' }}>{label}</span>
                  <input
                    type="number"
                    value={current.stats?.[i] ?? 0}
                    onChange={(e) => {
                      const cur = current.stats ?? [0, 0, 0, 0, 0];
                      const next = cur.map((v, j) => (j === i ? Number(e.target.value) : v)) as unknown as StatArray;
                      update(current.id, { stats: next });
                    }}
                    style={{ width: '5em' }}
                  />
                </div>
              ))}
              <div style={{ color: statSum === JOB_STATS_SUM ? 'var(--color-muted)' : 'var(--color-danger)' }}>
                合計 {statSum}{statSum !== JOB_STATS_SUM && ` (${JOB_STATS_SUM} にしないと保存できない)`}
              </div>
            </div>
            {field('たいりょく', (
              <input
                type="number" min={MIN_VIT} max={MAX_VIT}
                value={current.vit ?? 0}
                onChange={(e) => update(current.id, { vit: Number(e.target.value) })}
                style={{ width: '6em' }}
              />
            ))}
            {field('レベル曲線', (
              <span style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                <input
                  type="number" step={0.01} min={MIN_PACE} max={MAX_PACE}
                  value={current.pace ?? 1}
                  onChange={(e) => update(current.id, { pace: Number(e.target.value) })}
                  style={{ width: '6em' }}
                />
                <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>小さいほど早く上がる</span>
              </span>
            ))}
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>装備できるカテゴリ (common / cloth / charm は全職共通)</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4em', marginTop: '0.2em' }}>
                {ALL_KINDS.map((k) => {
                  const on = (current.equipKinds ?? JOB_EQUIP_KINDS[current.id]).includes(k);
                  return (
                    <label key={k} style={{ display: 'flex', gap: '0.2em', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          const base = current.equipKinds ?? [...JOB_EQUIP_KINDS[current.id]];
                          update(current.id, { equipKinds: e.target.checked ? [...base, k] : base.filter((x) => x !== k) });
                        }}
                      />
                      {k}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: '0.8em', borderTop: '1px solid var(--color-border)', paddingTop: '0.5em' }}>
        <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8em' }}>
          <strong style={{ fontSize: '0.95em' }}>連戦シミュレーション</strong>
          <label>tier <input type="number" min={1} max={8} value={tier} onChange={(e) => setTier(Number(e.target.value))} style={{ width: '4em' }} /></label>
          <label>Lv <input type="number" min={1} max={50} value={lv} onChange={(e) => setLv(Number(e.target.value))} style={{ width: '4em' }} /></label>
          <label>試行 <input type="number" min={1} max={200} value={trials} onChange={(e) => setTrials(Number(e.target.value))} style={{ width: '5em' }} /></label>
          <button type="button" onClick={runSim} disabled={simBusy}>
            {simBusy ? '計算中…' : '編集値で試す'}
          </button>
          <span style={{ color: 'var(--color-muted)' }}>保存せずに試せる (端末にも残らない)</span>
        </div>
        {simRows && (
          <div style={{ marginTop: '0.4em', fontSize: '0.8em' }}>
            <div style={{ color: 'var(--color-muted)' }}>
              街に戻らず何戦もつか (平均 {(simRows.reduce((s, r) => s + r.avg, 0) / simRows.length).toFixed(1)} 戦)
            </div>
            {(() => {
              // 棒の目盛りは**その回の最大値**に合わせる (固定係数だと強い職が振り切れて差が見えない)。
              const max = Math.max(1, ...simRows.map((r) => r.avg));
              return simRows.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                  <span style={{ width: '6em' }}>{jobDisplayName(r.id, 'default')}</span>
                  <span style={{ width: '3.5em', textAlign: 'right' }}>{r.avg.toFixed(1)}</span>
                  <span style={{ background: 'var(--color-accent)', height: 8, width: `${(r.avg / max) * 70}%` }} />
                  {/* 上限で打ち切った試行があると平均は過小評価。黙って頭打ちにしない */}
                  {r.capped > 0 && (
                    <span style={{ color: 'var(--color-danger)' }}>打ち切り {r.capped}/{trials}</span>
                  )}
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
