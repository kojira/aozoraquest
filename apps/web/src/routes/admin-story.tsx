import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  activeEquipment, activeItems, MAX_FLAGS, MAX_PLACED_ITEMS, MAX_PLACED_REWARDS, PLACED_KINDS, placedItemPlacementIssue, placedItemReachable, placedKind,
  placedRewards, storyFlagCount, validateStory, WORLD_MAP_ID, type NpcDef, type NpcPlacementWorld, type PlacedItemDef, type PlacedKind,
  type PlacedReward, type ScenarioEvent, type StoryData,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadStoryAuthoringRecords, saveStoryPlacedItems } from '@/lib/world-authoring';
import { NpcPlacementMap, type PlacementMarker } from '@/components/admin/npc-placement-map';
import '@/components/admin/npc-placement-map.css';

const KIND_LABEL: Record<PlacedKind, string> = { spot: 'しらべる場所', chest: '宝箱', sparkle: 'キラキラ' };
const KIND_COLOR: Record<PlacedKind, string> = { spot: '#6b6152', chest: '#a8692c', sparkle: '#2b74c4' };
const KIND_MARK: Record<PlacedKind, string> = { spot: '調', chest: '箱', sparkle: '光' };
type RewardKind = 'item' | 'equipment' | 'power';
const rewardKind = (r: PlacedReward): RewardKind => ('item' in r ? 'item' : 'equipment' in r ? 'equipment' : 'power');
/** 地図の選択用に、置きアイテムを NPC の形で渡す (地図は NPC エディタと同じものを使う)。 */
/** 編集の差分。undefined はその欄を消す。 */
type PlacedPatch = { [K in keyof PlacedItemDef]?: PlacedItemDef[K] | undefined };
const asPin = (p: PlacedItemDef): NpcDef => ({ id: `placed:${p.id}`, name: p.id, mapId: p.mapId, x: p.x, y: p.y, lines: [''] });

/**
 * **宝箱・キラキラ** (D-CHEST-001 §7)。world.story の置きアイテムだけを編集する。戦闘と固定モンスターは
 * 保存のときにそのまま書き戻す。**既存の id は変えられない** — 変えると全員の宝箱が閉じた状態に戻る。
 * 検証は core の validateStory。置いたマスは保存のときに、新しく置いた・動かしたものだけ確かめる。
 */
export function AdminStory() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [data, setData] = useState<{ world: NpcPlacementWorld; npcs: NpcDef[]; events: ScenarioEvent[]; story: StoryData } | null>(null);
  const [list, setList] = useState<PlacedItemDef[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [mapId, setMapId] = useState(WORLD_MAP_ID);
  const [note, setNote] = useState<string | null>(null);
  const [newId, setNewId] = useState('');
  const [coords, setCoords] = useState({ x: '', y: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const did = getPrimaryAdminDid();
    if (!admin || !session.agent || !did) return;
    void loadStoryAuthoringRecords(session.agent, did, () => !cancelled).then((d) => {
      if (cancelled) return;
      setData(d); setList(structuredClone(d.story.placedItems ?? []));
    }).catch((e: unknown) => { if (!cancelled) setNote(`読み込めなかった。上書きで消える恐れがあるので保存できない (${String(e)})`); });
    return () => { cancelled = true; };
  }, [session.agent, admin]);

  if (!admin) return <div style={{ padding: '1em' }}><p>この画面は管理者だけが使えます。</p><Link to="/admin">管理ダッシュボードへ</Link></div>;
  if (!data) return <div className="admin-page npc-editor"><p role="status">{note ?? '地図と置きアイテムを読み込んでいます…'}</p><Link to="/admin">← 管理</Link></div>;

  const saved = data.story.placedItems ?? [];
  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  const current = list.find((p) => p.id === sel) ?? null;
  const savedIds = new Set(saved.map((p) => p.id));
  const flagCount = storyFlagCount(data.events, { ...data.story, placedItems: list });
  const scenarioFlags = [...new Set(data.events.flatMap((e) => e.setFlags))].sort();
  const placeIssue = (p: PlacedItemDef) => placedItemPlacementIssue(data.world, p, data.npcs, data.story.fieldMonsters ?? []);
  const mapName = (id: string) => (id === WORLD_MAP_ID ? 'フィールド' : data.world.interiors.find((m) => m.id === id)?.name ?? `${id}（存在しない）`);

  const update = (id: string, patch: PlacedPatch) => setList((xs) => xs.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch } as PlacedItemDef & Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    return next;
  }));
  const setRewards = (p: PlacedItemDef, rewards: PlacedReward[]) => update(p.id, { rewards, itemId: undefined, count: undefined });
  const place = (p: PlacedItemDef, at: { mapId?: string; x: number; y: number }) => {
    const moved = { ...p, mapId: at.mapId ?? mapId, x: at.x, y: at.y };
    const issue = placeIssue(moved);
    if (issue) { setNote(`置けない: ${issue}`); return; }
    update(p.id, { mapId: moved.mapId, x: moved.x, y: moved.y });
    setNote(placedItemReachable(data.world, moved, data.npcs) ? `(${moved.x}, ${moved.y}) に置いた。未保存` : `(${moved.x}, ${moved.y}) に置いた。入口から歩いて行けないかもしれない（保存はできる）`);
  };
  const add = (kind: PlacedKind) => {
    const id = newId.trim();
    if (!id) return;
    if (list.some((p) => p.id === id)) { setNote(`id「${id}」はもうある`); return; }
    const p: PlacedItemDef = { id, mapId, x: -1, y: -1, kind, rewards: [{ item: 'herb', count: 1 }], ...(kind === 'spot' ? { flag: `got-${id}` } : {}) };
    setList((xs) => [...xs, p]); setSel(id); setNewId(''); setNote('地図か座標で場所を選んでください');
  };
  const save = async () => {
    if (!session.agent || saving) return;
    try {
      validateStory({ ...data.story, placedItems: list }, data.events);
      setSaving(true);
      const story = await saveStoryPlacedItems(session.agent, data.story, list, { world: data.world, npcs: data.npcs, events: data.events });
      setData({ ...data, story }); setList(structuredClone(story.placedItems ?? []));
      setNote(`${list.length} 件を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) { setNote(`保存できない: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setSaving(false); }
  };

  const markers: PlacementMarker[] = list.filter((p) => p.mapId === mapId).map((p) => ({ x: p.x, y: p.y, color: KIND_COLOR[placedKind(p)], label: KIND_MARK[placedKind(p)], selected: p.id === sel }));
  return (
    <div className="admin-page npc-editor">
      <fieldset disabled={saving}>
        <div className="admin-head">
          <Link to="/admin" onClick={(e) => { if (dirty && !window.confirm('未保存の変更を破棄して戻りますか？')) e.preventDefault(); }} style={{ fontSize: '0.8em' }}>← 管理</Link>
          <strong>宝箱・キラキラ</strong>
          <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>フラグ {flagCount}/{MAX_FLAGS}、置きアイテム {list.length}/{MAX_PLACED_ITEMS}</span>
          <button type="button" onClick={() => void save()} disabled={!dirty} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>{saving ? '保存中…' : '保存'}</button>
        </div>
        {note && <p role="status" style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}
        <div style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', fontSize: '0.85em', marginBottom: '0.4em' }}>
          <label>マップ <select aria-label="マップ" value={mapId} onChange={(e) => setMapId(e.target.value)}>
            <option value={WORLD_MAP_ID}>フィールド</option>
            {data.world.interiors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></label>
          <input aria-label="新しい id" value={newId} placeholder="id（あとで変えられない）" onChange={(e) => setNewId(e.target.value)} style={{ width: '13em', fontFamily: 'ui-monospace, monospace' }} />
          {PLACED_KINDS.map((k) => <button key={k} type="button" disabled={!newId.trim()} onClick={() => add(k)}>＋{KIND_LABEL[k]}</button>)}
        </div>
        <div className="admin-cols">
          <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {list.map((p) => (
              <button key={p.id} type="button" onClick={() => { setSel(p.id); if (p.x >= 0) setMapId(p.mapId); setCoords({ x: String(p.x), y: String(p.y) }); }}
                style={{ display: 'flex', gap: '0.4em', textAlign: 'left', fontSize: '0.85em', border: sel === p.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', background: 'transparent' }}>
                <span style={{ color: KIND_COLOR[placedKind(p)] }}>{KIND_MARK[placedKind(p)]}</span>
                <span style={{ flex: 1 }}>{p.id}</span>
                <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{mapName(p.mapId)} ({p.x},{p.y})</span>
              </button>
            ))}
          </div>
          {current ? <PlacedForm p={current} isNew={!savedIds.has(current.id)} scenarioFlags={scenarioFlags} coords={coords} setCoords={setCoords}
            onPlace={(at) => place(current, at)} onChange={(patch) => update(current.id, patch)} onRewards={(r) => setRewards(current, r)}
            onDelete={() => { setList((xs) => xs.filter((x) => x.id !== current.id)); setSel(null); }}
            map={<NpcPlacementMap key={`${current.id}/${mapId}`} world={data.world} npc={asPin(current)} draft={[]} mapId={mapId} markers={markers}
              validate={(at) => placeIssue({ ...current, mapId, ...at })} onPlace={(at) => place(current, at)} />} />
            : <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか、id を入れて足す</p>}
        </div>
      </fieldset>
    </div>
  );
}

function PlacedForm({ p, isNew, scenarioFlags, coords, setCoords, onPlace, onChange, onRewards, onDelete, map }: {
  p: PlacedItemDef; isNew: boolean; scenarioFlags: string[]; coords: { x: string; y: string }; setCoords: (c: { x: string; y: string }) => void;
  onPlace: (at: { x: number; y: number }) => void; onChange: (patch: PlacedPatch) => void; onRewards: (r: PlacedReward[]) => void; onDelete: () => void; map: React.ReactNode;
}) {
  const rewards = placedRewards(p);
  const setReward = (i: number, r: PlacedReward) => onRewards(rewards.map((x, j) => (j === i ? r : x)));
  const blank = (k: RewardKind): PlacedReward => (k === 'item' ? { item: 'herb', count: 1 } : k === 'equipment' ? { equipment: activeEquipment()[0]?.id ?? '' } : { power: 1 });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em', minWidth: 0, fontSize: '0.85em' }}>
      <div><code>{p.id}</code>{isNew ? '（新規。保存すると id は変えられない）' : ''} <button type="button" className="secondary" onClick={onDelete}>消す</button></div>
      <label className="admin-field"><span>種類</span><select aria-label="種類" value={placedKind(p)} onChange={(e) => onChange({ kind: e.target.value as PlacedKind })}>
        {PLACED_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select></label>
      {rewards.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.3em', flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label={`報酬 ${i + 1} の種類`} value={rewardKind(r)} onChange={(e) => setReward(i, blank(e.target.value as RewardKind))}>
            <option value="item">アイテム</option><option value="equipment">装備</option><option value="power">パワー</option>
          </select>
          {'item' in r && <>
            <input aria-label={`報酬 ${i + 1} の id`} list="placed-item-ids" value={r.item} onChange={(e) => setReward(i, { item: e.target.value, count: r.count })} style={{ width: '9em' }} />
            <input aria-label={`報酬 ${i + 1} の量`} type="number" min={1} max={99} value={r.count} onChange={(e) => setReward(i, { item: r.item, count: Number(e.target.value) })} style={{ width: '4em' }} />
          </>}
          {'equipment' in r && <select aria-label={`報酬 ${i + 1} の id`} value={r.equipment} onChange={(e) => setReward(i, { equipment: e.target.value })}>
            {activeEquipment().map((eq) => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </select>}
          {'power' in r && <input aria-label={`報酬 ${i + 1} の量`} type="number" min={1} max={50} value={r.power} onChange={(e) => setReward(i, { power: Number(e.target.value) })} style={{ width: '4em' }} />}
          <button type="button" className="secondary" disabled={rewards.length <= 1} onClick={() => onRewards(rewards.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" disabled={rewards.length >= MAX_PLACED_REWARDS} onClick={() => onRewards([...rewards, blank('item')])}>＋報酬</button>
      <datalist id="placed-item-ids">{activeItems().map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}</datalist>
      <label className="admin-field"><span>条件のフラグ</span><select aria-label="条件のフラグ" multiple value={p.requireFlags ?? []} onChange={(e) => {
        const v = [...e.target.selectedOptions].map((o) => o.value); onChange({ requireFlags: v.length ? v : undefined });
      }}>{[...new Set([...scenarioFlags, ...(p.requireFlags ?? [])])].map((f) => <option key={f} value={f}>{f}</option>)}</select></label>
      <label className="admin-field"><span>立てるフラグ{placedKind(p) === 'spot' ? '（必須）' : '（任意）'}</span>
        <input aria-label="立てるフラグ" value={p.flag ?? ''} onChange={(e) => onChange({ flag: e.target.value || undefined })} /></label>
      <label className="admin-field"><span>hint（1 行 40 字）</span><input aria-label="hint" maxLength={40} value={p.hint ?? ''} onChange={(e) => onChange({ hint: e.target.value || undefined })} /></label>
      {map}
      <div className="npc-coordinates">
        <input aria-label="座標 x" inputMode="numeric" value={coords.x} onChange={(e) => setCoords({ ...coords, x: e.target.value })} />
        <input aria-label="座標 y" inputMode="numeric" value={coords.y} onChange={(e) => setCoords({ ...coords, y: e.target.value })} />
        <button type="button" onClick={() => onPlace({ x: Number(coords.x), y: Number(coords.y) })}>この座標に置く</button>
      </div>
    </div>
  );
}
