import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activeMonsters,
  monsterCountByTier,
  baselineXp,
  battleXpFor,
  runAutoBattle,
  startBattle,
  setMonsterOverrides,
  MonsterDataError,
  JOBS,
  type MonsterDef,
  type Tier,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveMonsters } from '@/lib/world-authoring';
import { MonsterSvg } from '@/components/monster-svg';

/**
 * **モンスターエディタ** (#419)。一覧・編集・複製・削除と、保存前の検証・模擬戦。
 *
 * 保存先は管理者 PDS の `world.monsters` (#537)。読み込みは `loadAuthoredWorld` が
 * 起動時に済ませているので、この画面は `activeMonsters()` (= 差し替え済みの現物) から
 * 始めればよい。保存はレコード全置換 (壊れた 1 体で全体を落とす検証つき)。
 */

const ABILITY_LABELS: Record<string, string> = {
  '': 'plain (通常攻撃)',
  charger: 'charger (ため→強攻撃)',
  healer: 'healer (自己回復)',
  fleer: 'fleer (逃走)',
  caster: 'caster (魔法)',
};

const STAT_LABELS = ['こうげき', 'まもり', 'すばやさ', 'かしこさ', 'うん'] as const;

export function AdminMonsters() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<MonsterDef[]>(() => activeMonsters().map((m) => ({ ...m })));
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const current = useMemo(() => list.find((m) => m.id === sel) ?? null, [list, sel]);
  const counts = monsterCountByTier(list);

  // exactOptionalPropertyTypes のため、undefined を「キーごと消す」に読み替える
  const update = useCallback((id: string, patch: { [K in keyof MonsterDef]?: MonsterDef[K] | undefined }) => {
    setList((xs) => xs.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return next as unknown as MonsterDef;
    }));
    setDirty(true);
  }, []);

  const duplicate = useCallback((src: MonsterDef) => {
    // **既存を複製して始める。** 15 フィールドをゼロから埋めさせない。
    let n = 2;
    while (list.some((m) => m.id === `${src.id}-${n}`)) n++;
    const copy: MonsterDef = { ...src, id: `${src.id}-${n}`, name: `${src.name} (コピー)` };
    setList((xs) => [...xs, copy]);
    setSel(copy.id);
    setDirty(true);
  }, [list]);

  const remove = useCallback((id: string) => {
    const target = list.find((m) => m.id === id);
    if (!target) return;
    const after = list.filter((m) => m.id !== id);
    // **tier が痩せる削除は止める** (遭遇が壊れて街から出られなくなる)。
    const tierCount = after.filter((m) => m.tier === target.tier).length;
    if (target.tier <= 3 && tierCount < 3) {
      setNote(`消せない: tier${target.tier} が ${tierCount} 体になる (3 体未満は遭遇が壊れる)`);
      return;
    }
    if (!window.confirm(`「${target.name}」を消す？`)) return;
    setList(after);
    setSel(null);
    setDirty(true);
  }, [list]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      const n = await saveMonsters(session.agent, list);
      setDirty(false);
      setNote(`${n} 体を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      // 検証エラーはどの敵かまで出る (MonsterDataError)
      setNote(e instanceof MonsterDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, list]);

  /** 模擬戦: 保存前に手応えを見る。全 16 職 × 60 seed の勝率。
   *  **編集中の値を一時適用して回し、終わったら必ず戻す** — 戻さないと保存していない
   *  編集がワールド画面の戦闘にまで効いてしまう (マップの draft と同じ理屈)。 */
  const simulate = useCallback((def: MonsterDef) => {
    try {
      setMonsterOverrides(list); // 編集中の値で (finally で戻す)
      let wins = 0;
      let total = 0;
      for (const j of JOBS) {
        for (let seed = 0; seed < 60; seed++) {
          const r = runAutoBattle(startBattle(j.id, Math.max(1, (def.level ?? 1)), 1, 'x', def.tier, seed, 2, undefined, { monsterId: def.id }));
          total++;
          if (r.outcome === 'win') wins++;
        }
      }
      setNote(`${def.name}: 想定 Lv での勝率 ${((wins / total) * 100).toFixed(0)}% (全職 × 60 seed) / XP ${battleXpFor(def.id)} (式なら ${baselineXp(def)})`);
    } catch (e) {
      setNote(`模擬戦できない: ${String(e)}`);
    } finally {
      setMonsterOverrides(null); // 保存前の編集を残さない (次の loadAuthoredWorld で保存済みへ戻る)
    }
  }, [list]);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

  const field = (label: string, input: React.ReactNode) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.8em' }}>
      <span style={{ width: '7em', color: 'var(--color-muted)' }}>{label}</span>
      {input}
    </label>
  );

  return (
    <div style={{ padding: '0.8em', maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center', marginBottom: '0.4em' }}>
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>モンスター</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
          {([1, 2, 3, 4, 5, 6] as Tier[]).map((t) => `t${t}:${counts[t] ?? 0}`).join(' ')}
        </span>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 2fr', gap: '0.8em' }}>
        {/* 一覧 (tier ごと) */}
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {([1, 2, 3, 4, 5, 6, 7, 8] as Tier[]).map((t) => {
            const inTier = list.filter((m) => m.tier === t);
            if (inTier.length === 0) return null;
            return (
              <div key={t}>
                <div style={{ fontSize: '0.7em', color: 'var(--color-muted)', margin: '0.4em 0 0.2em' }}>tier{t}</div>
                {inTier.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSel(m.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4em', width: '100%',
                      padding: '0.2em 0.4em', fontSize: '0.85em', textAlign: 'left',
                      border: sel === m.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                      background: 'transparent',
                    }}
                  >
                    <MonsterSvg species={m.species} tint={m.tint} size={22} />
                    <span style={{ flex: 1 }}>{m.name}</span>
                    <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>xp{battleXpFor(m.id) || baselineXp(m)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* 編集フォーム */}
        {current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
              <MonsterSvg species={current.species} tint={current.tint} size={48} />
              <strong>{current.name}</strong>
              <code style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{current.id}</code>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3em' }}>
                <button type="button" onClick={() => duplicate(current)} style={{ fontSize: '0.8em' }}>複製</button>
                <button type="button" onClick={() => simulate(current)} style={{ fontSize: '0.8em' }}>模擬戦</button>
                <button type="button" className="secondary" onClick={() => remove(current.id)} style={{ fontSize: '0.8em' }}>削除</button>
              </span>
            </div>
            {field('なまえ', <input value={current.name} onChange={(e) => update(current.id, { name: e.target.value })} />)}
            {field('tier', (
              <select value={current.tier} onChange={(e) => update(current.id, { tier: Number(e.target.value) as Tier })}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ))}
            {field('想定 Lv', <input type="number" value={current.level ?? 1} onChange={(e) => update(current.id, { level: Number(e.target.value) })} style={{ width: '5em' }} />)}
            {field('HP', <input type="number" value={current.hp ?? 0} onChange={(e) => update(current.id, { hp: Number(e.target.value) })} style={{ width: '5em' }} />)}
            {field('MP', <input type="number" value={current.mp ?? 0} onChange={(e) => update(current.id, { mp: Number(e.target.value) })} style={{ width: '5em' }} />)}
            {STAT_LABELS.map((label, i) => field(label, (
              <input
                type="number"
                value={current.stats[i]}
                onChange={(e) => {
                  const stats = [...current.stats] as unknown as MonsterDef['stats'];
                  (stats as unknown as number[])[i] = Number(e.target.value);
                  update(current.id, { stats });
                }}
                style={{ width: '5em' }}
              />
            )))}
            {field('XP 上書き', (
              <input
                type="number"
                value={current.xp ?? ''}
                placeholder={`式: ${baselineXp(current)}`}
                onChange={(e) => update(current.id, { xp: e.target.value === '' ? undefined : Number(e.target.value) })}
                style={{ width: '6em' }}
              />
            ))}
            {field('出現の重み', <input type="number" step="0.01" value={current.spawnWeight ?? 1} onChange={(e) => update(current.id, { spawnWeight: Number(e.target.value) })} style={{ width: '5em' }} />)}
            {field('能力', (
              <select
                value={current.ability ?? ''}
                onChange={(e) => update(current.id, { ability: (e.target.value || undefined) as MonsterDef['ability'] })}
              >
                {Object.entries(ABILITY_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
            ))}
            {current.ability === 'charger' && field('技名', <input value={current.skillName ?? ''} onChange={(e) => update(current.id, { skillName: e.target.value || undefined })} />)}
            {current.ability === 'healer' && field('回復技名', <input value={current.healName ?? ''} onChange={(e) => update(current.id, { healName: e.target.value || undefined })} />)}
            {current.ability === 'caster' && field('spell (JSON)', (
              <input
                value={JSON.stringify(current.spell ?? null)}
                onChange={(e) => {
                  try { update(current.id, { spell: JSON.parse(e.target.value) || undefined }); } catch { /* 入力途中 */ }
                }}
                style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }}
              />
            ))}
            {field('ひとこと', <input value={current.intro} onChange={(e) => update(current.id, { intro: e.target.value })} style={{ width: '100%' }} />)}
            {/* ドロップ */}
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>ドロップ</span>
              {current.drops.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center', margin: '0.15em 0' }}>
                  <input
                    value={d.item}
                    onChange={(e) => {
                      const drops = current.drops.map((x, j) => (j === i ? { ...x, item: e.target.value } : x));
                      update(current.id, { drops });
                    }}
                    style={{ width: '10em' }}
                  />
                  <input
                    type="number" step="0.05" min="0" max="1"
                    value={d.chance}
                    onChange={(e) => {
                      const drops = current.drops.map((x, j) => (j === i ? { ...x, chance: Number(e.target.value) } : x));
                      update(current.id, { drops });
                    }}
                    style={{ width: '5em' }}
                  />
                  <button type="button" onClick={() => update(current.id, { drops: current.drops.filter((_, j) => j !== i) })} style={{ fontSize: '0.8em' }}>×</button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update(current.id, { drops: [...current.drops, { item: 'slime-drop', chance: 0.2 }] })}
                style={{ fontSize: '0.8em', marginTop: '0.2em' }}
              >
                ＋ドロップ
              </button>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶ。増やすときは近い敵を選んで「複製」。</div>
        )}
      </div>
    </div>
  );
}
