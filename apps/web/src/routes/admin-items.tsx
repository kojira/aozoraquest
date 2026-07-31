import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GEAR_SLOTS,
  GEAR_SLOT_LABELS,
  activeEquipment,
  activeItems,
  canEquip,
  ItemDataError,
  JOBS,
  JOB_EQUIP_KINDS,
  type EquipmentDef,
  type ItemDefData,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveItems } from '@/lib/world-authoring';

/**
 * **アイテムエディタ** (#420)。そうび / どうぐ・素材 の 2 タブ。
 *
 * モンスターエディタ (#419) と同じ流儀: 保存先は管理者 PDS の `world.items`、
 * 保存前に core の検証 (壊れた 1 件で全体を落とす)、複製して増やす。
 */

const SLOT_LABELS: Record<string, string> = GEAR_SLOT_LABELS;
const BONUS_LABELS: Array<[keyof EquipmentDef['bonus'], string]> = [
  ['atk', 'こうげき'], ['def', 'まもり'], ['agi', 'すばやさ'], ['int', 'かしこさ'], ['luk', 'うん'], ['maxHp', 'さいだいHP'],
];
const ALL_KINDS = ['common', 'cloth', 'charm', 'exclusive', ...new Set(Object.values(JOB_EQUIP_KINDS).flat())];

export function AdminItems() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [tab, setTab] = useState<'equipment' | 'items'>('equipment');
  const [equipment, setEquipment] = useState<EquipmentDef[]>(() => activeEquipment().map((e) => ({ ...e, bonus: { ...e.bonus }, price: { ...e.price } })));
  const [items, setItems] = useState<ItemDefData[]>(() => activeItems());
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const current = useMemo(() => equipment.find((e) => e.id === sel) ?? null, [equipment, sel]);

  const update = useCallback((id: string, patch: { [K in keyof EquipmentDef]?: EquipmentDef[K] | undefined }) => {
    setEquipment((xs) => xs.map((e) => {
      if (e.id !== id) return e;
      const next = { ...e } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      return next as unknown as EquipmentDef;
    }));
    setDirty(true);
  }, []);

  const duplicate = useCallback((src: EquipmentDef) => {
    let n = 2;
    while (equipment.some((e) => e.id === `${src.id}-${n}`)) n++;
    const copy: EquipmentDef = { ...src, id: `${src.id}-${n}`, name: `${src.name} (コピー)`, bonus: { ...src.bonus }, price: { ...src.price } };
    setEquipment((xs) => [...xs, copy]);
    setSel(copy.id);
    setDirty(true);
  }, [equipment]);

  const removeEquip = useCallback((id: string) => {
    const target = equipment.find((e) => e.id === id);
    if (!target) return;
    // **持っている人がいるかは分からない** (pieces は各ユーザーの権威レコード)。
    // 消しても壊れない (未知 id の装備は無視される設計) が、その品は永久に使えなくなる。
    if (!window.confirm(`「${target.name}」を消す？\n既に持っている人の個体は「効果のない置き物」になる`)) return;
    setEquipment((xs) => xs.filter((e) => e.id !== id));
    setSel(null);
    setDirty(true);
  }, [equipment]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveItems(session.agent, items, equipment);
      setDirty(false);
      setNote('保存した。サーバーは最大 5 分で拾う');
    } catch (e) {
      setNote(e instanceof ItemDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    }
  }, [session.agent, items, equipment]);

  /** その品を装備できる職 (kind × jobOnly の帰結を可視化する)。 */
  const wearers = useCallback((def: EquipmentDef): string =>
    JOBS.filter((j) => canEquip(j.id, def)).map((j) => j.id).join(' ') || 'だれも装備できない！',
  []);

  if (!admin) {
    return (
      <div style={{ padding: '1em' }}>
        <p>この画面は管理者だけが使えます。</p>
        <Link to="/admin">管理ダッシュボードへ</Link>
      </div>
    );
  }

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
        {([['equipment', 'そうび'], ['items', 'どうぐ・素材']] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{ fontSize: '0.85em', padding: '0.25em 0.7em', border: tab === k ? '3px solid var(--color-accent)' : '1px solid var(--color-border)' }}
          >
            {label}
          </button>
        ))}
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      {tab === 'items' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2em', maxWidth: 460 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
              <input
                value={it.id}
                onChange={(e) => { setItems((xs) => xs.map((x, j) => (j === i ? { ...x, id: e.target.value } : x))); setDirty(true); }}
                style={{ width: '11em', fontFamily: 'ui-monospace, monospace', fontSize: '0.85em' }}
              />
              <input
                value={it.name}
                onChange={(e) => { setItems((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); setDirty(true); }}
                style={{ flex: 1 }}
              />
              {/* だいじなもの (シナリオアイテム)。ひきとってもらえず、負けても失わない (#426) */}
              <label style={{ display: 'flex', gap: '0.2em', alignItems: 'center', fontSize: '0.8em', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={!!it.key}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setItems((xs) => xs.map((x, j) => {
                      if (j !== i) return x;
                      if (!on) { const { key: _k, ...rest } = x; return rest as ItemDefData; }
                      return { ...x, key: true };
                    }));
                    setDirty(true);
                  }}
                />
                だいじ
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`「${it.name}」を消す？\nドロップや在庫でこの id を参照している箇所は名前が出なくなる`)) return;
                  setItems((xs) => xs.filter((_, j) => j !== i));
                  setDirty(true);
                }}
                style={{ fontSize: '0.8em' }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => { setItems((xs) => [...xs, { id: `item-${xs.length + 1}`, name: 'あたらしいどうぐ' }]); setDirty(true); }}
            style={{ fontSize: '0.85em', alignSelf: 'flex-start', marginTop: '0.3em' }}
          >
            ＋どうぐ
          </button>
          <button
            type="button"
            onClick={() => { setItems((xs) => [...xs, { id: `key-${xs.length + 1}`, name: 'あたらしい だいじなもの', key: true }]); setDirty(true); }}
            style={{ fontSize: '0.85em', alignSelf: 'flex-start' }}
          >
            ＋だいじなもの
          </button>
          <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.3em 0 0' }}>
            だいじなもの: ひきとってもらえず、負けても失わない。
            <Link to="/admin/scenario">シナリオ</Link>の条件や、クエスト・ゲートの解禁に使える
          </p>
        </div>
      ) : (
        <div className="admin-cols">
          {/* 一覧 (slot → grade) */}
          <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {GEAR_SLOTS.map((slot) => {
              const inSlot = equipment.filter((e) => e.slot === slot).sort((a, b) => a.grade - b.grade);
              if (inSlot.length === 0) return null;
              return (
                <div key={slot}>
                  <div style={{ fontSize: '0.7em', color: 'var(--color-muted)', margin: '0.4em 0 0.2em' }}>{SLOT_LABELS[slot]}</div>
                  {inSlot.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSel(e.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.4em', width: '100%',
                        padding: '0.2em 0.4em', fontSize: '0.85em', textAlign: 'left',
                        border: sel === e.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                        background: 'transparent',
                      }}
                    >
                      <span style={{ flex: 1 }}>{e.name}</span>
                      <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>g{e.grade}{e.jobOnly ? ` ${e.jobOnly}` : ''}</span>
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
                <strong>{current.name}</strong>
                <code style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{current.id}</code>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3em' }}>
                  <button type="button" onClick={() => duplicate(current)} style={{ fontSize: '0.8em' }}>複製</button>
                  <button type="button" className="secondary" onClick={() => removeEquip(current.id)} style={{ fontSize: '0.8em' }}>削除</button>
                </span>
              </div>
              {field('なまえ', <input value={current.name} onChange={(e) => update(current.id, { name: e.target.value })} />)}
              {field('部位', (
                <select
                  value={current.slot}
                  onChange={(e) => {
                    const slot = e.target.value as EquipmentDef['slot'];
                    // 武器/盾以外へ変えるとき hands を残すと検証で保存が全体ブロックされ、
                    // 手数セレクトも非表示で復旧手段が無くなる (レビュー ★★)。同時に消す。
                    const clearHands = slot !== 'weapon' && slot !== 'shield';
                    update(current.id, { slot, ...(clearHands ? { hands: undefined } : {}) });
                  }}
                >
                  {GEAR_SLOTS.map((s0) => <option key={s0} value={s0}>{SLOT_LABELS[s0]}</option>)}
                </select>
              ))}
              {(current.slot === 'weapon' || current.slot === 'shield') && field('手数', (
                <select
                  value={current.hands ?? 1}
                  onChange={(e) => {
                    const hands = Number(e.target.value) as 1 | 2;
                    // 片手 (既定) はキーごと消す (update は undefined で delete する契約)
                    update(current.id, { hands: hands === 1 ? undefined : hands });
                  }}
                >
                  <option value={1}>片手</option>
                  <option value={2}>両手 (盾と併用できない)</option>
                </select>
              ))}
              {field('系統', (
                <select value={current.kind} onChange={(e) => update(current.id, { kind: e.target.value as EquipmentDef['kind'] })}>
                  {ALL_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              ))}
              {field('grade', (
                <span style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
                  <select value={current.grade} onChange={(e) => update(current.id, { grade: Number(e.target.value) as EquipmentDef['grade'] })}>
                    {[1, 2, 3].map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                  <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>売られる街の帯 (1=tier1〜 2=tier2〜 3=tier3〜)</span>
                </span>
              ))}
              {field('専用ジョブ', (
                <select
                  value={current.jobOnly ?? ''}
                  onChange={(e) => update(current.id, { jobOnly: (e.target.value || undefined) as EquipmentDef['jobOnly'] })}
                >
                  <option value="">なし (系統で判定)</option>
                  {JOBS.map((j) => <option key={j.id} value={j.id}>{j.id}</option>)}
                </select>
              ))}
              {BONUS_LABELS.map(([key, label]) => field(label, (
                <input
                  type="number"
                  value={current.bonus[key] ?? ''}
                  placeholder="0"
                  onChange={(e) => {
                    const bonus = { ...current.bonus };
                    if (e.target.value === '') delete bonus[key];
                    else bonus[key] = Number(e.target.value);
                    update(current.id, { bonus });
                  }}
                  style={{ width: '5em' }}
                />
              )))}
              {field('値段', (
                <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
                  パワー
                  <input
                    type="number" min="0"
                    value={current.price.power}
                    onChange={(e) => update(current.id, { price: { ...current.price, power: Number(e.target.value) } })}
                    style={{ width: '5em' }}
                  />
                  + 素材
                  <input
                    type="number" min="0"
                    value={current.price.materials}
                    onChange={(e) => update(current.id, { price: { ...current.price, materials: Number(e.target.value) } })}
                    style={{ width: '4em' }}
                  />
                  こ
                </span>
              ))}
              {/* **誰が装備できるかを常に見せる。** kind と jobOnly の組み合わせは間違えやすく、
                  「exclusive なのに jobOnly なし = 誰も装備できない」を静かに作らないため。 */}
              <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', lineHeight: 1.6 }}>
                装備できる職: {wearers(current)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶ。増やすときは近い品を選んで「複製」。</div>
          )}
        </div>
      )}
    </div>
  );
}
