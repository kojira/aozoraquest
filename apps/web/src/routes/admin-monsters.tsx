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
  ITEMS,
  type Element,
  type MonsterDef,
  type Tier,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveMonsters } from '@/lib/world-authoring';
import { MonsterSvg, bodyFor } from '@/components/monster-svg';
import { TileArtEditor, type ArtSubject } from '@/components/admin/tile-art-editor';
import { monsterArtKey } from '@aozoraquest/core';

/**
 * **モンスターエディタ** (#419)。一覧・編集・複製・削除と、保存前の検証・模擬戦。
 *
 * 保存先は管理者 PDS の `world.monsters` (#537)。読み込みは `loadAuthoredWorld` が
 * 起動時に済ませているので、この画面は `activeMonsters()` (= 差し替え済みの現物) から
 * 始めればよい。保存はレコード全置換 (壊れた 1 体で全体を落とす検証つき)。
 */

const ABILITY_LABELS: Record<string, string> = {
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
  // 絵を描くモード (ドット絵エディタを開く)。下敷きは従来の SVG。
  const [drawing, setDrawing] = useState(false);

  const current = useMemo(() => list.find((m) => m.id === sel) ?? null, [list, sel]);
  /** 単数 (旧) と複数 (新) を吸収した現在の能力列。 */
  const currentAbilities = useMemo(
    () => current?.abilities ?? (current?.ability ? [current.ability] : []),
    [current],
  );
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

  /** 能力パラメータ (0〜1) の 1 欄。空欄 = 全体既定。 */
  const paramField = (label: string, key: keyof NonNullable<MonsterDef['abilityParams']>, fallback: number) => {
    if (!current) return null;
    const val = current.abilityParams?.[key];
    return field(label, (
      <span style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
        <input
          type="number" step="0.05" min="0" max="1"
          value={val ?? ''}
          placeholder={String(fallback)}
          onChange={(e) => {
            const params = { ...current.abilityParams };
            if (e.target.value === '') delete params[key];
            else params[key] = Number(e.target.value);
            update(current.id, { abilityParams: Object.keys(params).length ? params : undefined });
          }}
          style={{ width: '5em' }}
        />
        <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>0〜1 (空欄 = {fallback})</span>
      </span>
    ));
  };

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
                    <MonsterSvg species={m.species} tint={m.tint} size={22} monsterId={m.id} />
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
              <MonsterSvg species={current.species} tint={current.tint} size={48} monsterId={current.id} />
              <strong>{current.name}</strong>
              <code style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{current.id}</code>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3em' }}>
                <button type="button" onClick={() => setDrawing((v) => !v)} style={{ fontSize: '0.8em' }}>
                  {drawing ? '絵を閉じる' : '絵をかく'}
                </button>
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
            {field('XP', (
              <span style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                <input
                  type="number"
                  value={current.xp ?? ''}
                  placeholder={String(baselineXp(current))}
                  onChange={(e) => update(current.id, { xp: e.target.value === '' ? undefined : Number(e.target.value) })}
                  style={{ width: '6em' }}
                />
                <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
                  空欄 = 強さから自動 ({baselineXp(current)})。特別に多く/少なくしたいときだけ入れる
                </span>
              </span>
            ))}
            {field('出現の重み', <input type="number" step="0.01" value={current.spawnWeight ?? 1} onChange={(e) => update(current.id, { spawnWeight: Number(e.target.value) })} style={{ width: '5em' }} />)}
            {currentAbilities.includes('fleer') && paramField('逃走の基礎確率', 'fleeBase', 0.35)}
            {field('能力', (
              <span style={{ display: 'flex', flexDirection: 'column', gap: '0.15em' }}>
                {/* **複数選べる。優先順は上から** (毎ターン上から聞き、最初に動いた能力を採る)。
                    選択順を保持するので、後から選んだものが末尾に付く。 */}
                {(['charger', 'healer', 'fleer', 'caster'] as const).map((id) => {
                  const selected = currentAbilities.includes(id);
                  const order = currentAbilities.indexOf(id);
                  return (
                    <label key={id} style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...currentAbilities, id]
                            : currentAbilities.filter((a) => a !== id);
                          update(current.id, {
                            abilities: next.length ? next : undefined,
                            ability: undefined, // 単数フィールドは複数側へ寄せる
                          });
                        }}
                      />
                      {selected && <span style={{ fontSize: '0.75em', color: 'var(--color-accent)' }}>{order + 1}.</span>}
                      <span>{ABILITY_LABELS[id]}</span>
                    </label>
                  );
                })}
                {currentAbilities.length > 1 && (
                  <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
                    番号の順に判定する (1 が動かなかったら 2 …)。選び直すと順番が変わる
                  </span>
                )}
              </span>
            ))}
            {currentAbilities.includes('charger') && (
              <>
                {field('技名', <input value={current.skillName ?? ''} onChange={(e) => update(current.id, { skillName: e.target.value || undefined })} />)}
                {paramField('ため確率', 'chargeChance', 0.4)}
              </>
            )}
            {currentAbilities.includes('healer') && (
              <>
                {field('回復技名', <input value={current.healName ?? ''} onChange={(e) => update(current.id, { healName: e.target.value || undefined })} />)}
                {paramField('回復確率', 'healChance', 0.5)}
                {paramField('発動する HP', 'lowHpRatio', 0.55)}
                {field('回復量', (
                  <span style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                    <input
                      type="number" min="1"
                      value={current.healAmount ?? ''}
                      placeholder={String(Math.round((current.hp ?? 10) * (current.healRatio ?? 0.3)))}
                      onChange={(e) => update(current.id, { healAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                      style={{ width: '5em' }}
                    />
                    <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
                      固定値 (空欄 = 最大 HP の割合で自動。割合回復は HP の大きい敵ほど強くなるので固定値を推奨)
                    </span>
                  </span>
                ))}
              </>
            )}
            {currentAbilities.includes('caster') && (
              <>
                {field('魔法の名前', (
                  <input
                    value={current.spell?.name ?? ''}
                    onChange={(e) => update(current.id, { spell: { min: 3, max: 6, ...current.spell, name: e.target.value } })}
                  />
                ))}
                {field('属性', (
                  <select
                    value={current.spell?.element ?? ''}
                    onChange={(e) => {
                      const next = { name: '', min: 3, max: 6, ...current.spell } as NonNullable<MonsterDef['spell']> & { element?: Element };
                      if (e.target.value === '') delete next.element;
                      else next.element = e.target.value as Element;
                      update(current.id, { spell: next });
                    }}
                  >
                    <option value="">なし (無属性)</option>
                    {(['fire', 'water', 'wind', 'earth', 'void'] as const).map((el) => (
                      <option key={el} value={el}>{el}</option>
                    ))}
                  </select>
                ))}
                {paramField('詠唱確率', 'castChance', 0.3)}
                {field('ダメージ', (
                  <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={current.spell?.min ?? 3}
                      onChange={(e) => update(current.id, { spell: { name: '', max: 6, ...current.spell, min: Number(e.target.value) } })}
                      style={{ width: '4.5em' }}
                    />
                    〜
                    <input
                      type="number"
                      value={current.spell?.max ?? 6}
                      onChange={(e) => update(current.id, { spell: { name: '', min: 3, ...current.spell, max: Number(e.target.value) } })}
                      style={{ width: '4.5em' }}
                    />
                    <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>+ かしこさ ×</span>
                    <input
                      type="number" step="0.05"
                      value={current.spell?.intScale ?? 0}
                      onChange={(e) => update(current.id, { spell: { name: '', min: 3, max: 6, ...current.spell, intScale: Number(e.target.value) } })}
                      style={{ width: '4.5em' }}
                    />
                  </span>
                ))}
              </>
            )}
            {field('ひとこと', <input value={current.intro} onChange={(e) => update(current.id, { intro: e.target.value })} style={{ width: '100%' }} />)}
            {drawing && (
              <TileArtEditor
                subjects={[{
                  key: monsterArtKey(current.id),
                  name: current.name,
                  seedColor: current.tint ?? '#8fd0ff',
                  // 下敷きは従来の SVG (なぞって描く)。ドット絵を保存すると戦闘画面も差し替わる
                  underlay: (
                    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
                      {bodyFor(current.species, current.tint)}
                    </svg>
                  ),
                } satisfies ArtSubject]}
              />
            )}
            {/* ドロップ */}
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>ドロップ</span>
              {current.drops.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center', margin: '0.15em 0' }}>
                  {/* **ゲーム内の名前で選ぶ。** 内部 id の自由入力は typo で「落ちない
                      ドロップ」を静かに作る (エラーにもならない)。 */}
                  <select
                    value={d.item}
                    onChange={(e) => {
                      const drops = current.drops.map((x, j) => (j === i ? { ...x, item: e.target.value } : x));
                      update(current.id, { drops });
                    }}
                  >
                    {Object.entries(ITEMS).map(([id, it]) => (
                      <option key={id} value={id}>{it.name}</option>
                    ))}
                  </select>
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
