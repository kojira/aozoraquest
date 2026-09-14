import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  danglingRefs, describeDanglingRef, npcArtKey, NpcDataError,
  starterTownNpcs, starterTownNpcsPlacementError, STARTER_TOWN_ID,
  NPC_SPRITE_PRESETS, tileArtFor, WORLD_MAP_ID, type NpcDef,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadNpcAuthoringRecords, saveNpcs } from '@/lib/world-authoring';
import { npcMapId, npcStructuralPlacementError, sameNpcPosition, validateNpcPlacement, type NpcPlacementWorld } from '@/lib/npc-placement';
import { NpcPlacementMap } from '@/components/admin/npc-placement-map';
import { NpcSprite } from '@/components/npc-sprite';
import { TileArtEditor, type ArtSubject } from '@/components/admin/tile-art-editor';
import { ItemReqInput } from '@/components/admin/item-req-input';

/**
 * **NPC エディタ** (#425)。マップ・位置・名前・セリフ・絵。
 *
 * NPC はタイルを 1 つ占め、**歩いてぶつかると会話が始まる** (移動判定でも塞ぐ =
 * web と edge の両方が同じ一覧を読む)。絵はドット絵 (`npc:<id>`)、無ければ代替の人形。
 * フィールドのほか内部マップ (#424) にも置ける (#613)。
 *
 * 保存先は管理者 PDS の `world.npcs`。マウント時に `loadAuthoredWorld` を回し、読み込めるまで
 * 編集も保存もさせない (直接開いて保存すると保存済みの編集を上書きする。#603)。
 * アイテム・内部マップも同時に揃う (フラグ別セリフの持ち物条件と「マップ」の選択肢が引く)。
 */

export function AdminNpcs() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<NpcDef[]>([]);
  const [snapshot, setSnapshot] = useState<NpcDef[]>([]);
  const [world, setWorld] = useState<NpcPlacementWorld | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [mapChoice, setMapChoice] = useState(WORLD_MAP_ID);
  const [note, setNote] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const loadedIdentity = useRef<{ agent: typeof session.agent; did: typeof session.did } | null>(null);
  const additions = useRef(new Map<string, NpcDef>());
  const dirty = JSON.stringify(list) !== JSON.stringify(snapshot);
  const loaded = loadState === 'ready' && loadedIdentity.current?.agent === session.agent && loadedIdentity.current?.did === session.did;
  const interiors = world?.interiors ?? [];
  const current = useMemo(() => list.find((n) => n.id === sel) ?? null, [list, sel]);
  const [coords, setCoords] = useState({ x: '', y: '' });
  useEffect(() => { setCoords({ x: String(current?.x ?? ''), y: String(current?.y ?? '') }); }, [current?.id, current?.x, current?.y, mapChoice]);
  useEffect(() => {
    let cancelled = false;
    setLoadState('loading'); setWorld(null); setList([]); setSnapshot([]); setSel(null); setDrawing(false); setNote(null);
    additions.current.clear();
    const did = getPrimaryAdminDid();
    if (!admin || !session.agent || !did) return () => { cancelled = true; };
    void loadNpcAuthoringRecords(session.agent, did, () => !cancelled).then((data) => {
      if (cancelled) return;
      setList(data.list); setSnapshot(structuredClone(data.list)); setWorld(data.world);
      loadedIdentity.current = { agent: session.agent, did: session.did }; setLoadState('ready');
    }).catch((error: unknown) => {
      if (!cancelled) { setNote(`読み込めませんでした: ${String(error)}`); setLoadState('error'); }
    });
    return () => { cancelled = true; };
  }, [session.agent, session.did, admin, retry]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const update = useCallback((id: string, patch: Partial<NpcDef>) => {
    if (saving) return;
    setList((xs) => xs.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      if (next.mapId === WORLD_MAP_ID) delete next.mapId;
      return next;
    }));
  }, [saving]);
  const choose = (n: NpcDef) => { setSel(n.id); setMapChoice(npcMapId(n)); setDrawing(false); };
  const cancelAll = () => {
    if (!window.confirm('未保存の変更をすべて取り消しますか？')) return;
    setList(structuredClone(snapshot)); additions.current.clear();
    const n = snapshot.find((n) => n.id === sel);
    setSel(n?.id ?? null); setMapChoice(n ? npcMapId(n) : WORLD_MAP_ID); setDrawing(false); setNote('未保存の変更を取り消しました');
  };

  const add = useCallback(() => {
    // spawn の隣に置いて始める (座標を手で探させない)。空いているマスを探す。
    if (!world) return;
    const sp = world.spawn;
    let x = sp.x + 1;
    let y = sp.y;
    while (list.some((n) => n.x === x && n.y === y)) x++;
    let i = list.length + 1;
    while (list.some((n) => n.id === `npc-${i}`)) i++;
    const npc: NpcDef = { id: `npc-${i}`, name: 'むらびと', x, y, lines: ['こんにちは、たびのひと。'] };
    setList((xs) => [...xs, npc]);
    additions.current.set(npc.id, structuredClone(npc));
    setSel(npc.id); setMapChoice(WORLD_MAP_ID); setDrawing(false);
  }, [list, world]);

  /**
   * **同梱の村人を入れる** (#656)。admin-interiors の「はじまりの村を入れる」と同じ流儀:
   * id が同じ村人は置き換え、他の NPC は残す。反映は「保存」(自動保存しない)。
   * 村が無い / 旧版 (大きさが違う) なら入れさせない — 判定は core (`starterTownNpcsPlacementError`)
   * が 1 か所で持つ。旧版に入れると保存は通るのに村人が壁の中に立つ。
   */
  const insertVillagers = useCallback(() => {
    const village = world?.interiors.find((m) => m.id === STARTER_TOWN_ID);
    const blocked = starterTownNpcsPlacementError(village);
    if (blocked || !village) {
      setNote(blocked);
      return;
    }
    const villagers = starterTownNpcs();
    const ids = new Set(villagers.map((n) => n.id));
    const existing = list.some((n) => ids.has(n.id));
    if (existing && !window.confirm(`「${village.name}」の村人を最新の同梱版で置き換える？\nこの村人たちに加えた編集は消える`)) return;
    for (const n of villagers) if (!snapshot.some((old) => old.id === n.id)) additions.current.set(n.id, structuredClone(n));
    setList((xs) => [...xs.filter((n) => !ids.has(n.id)), ...villagers]);
    setSel(villagers[0]?.id ?? null); setMapChoice(STARTER_TOWN_ID); setDrawing(false);
    setNote(`「${village.name}」の村人 ${villagers.length} 人を${existing ? '入れ直した' : '入れた'}。保存すると村に立つ`);
  }, [list, world, snapshot]);

  const save = useCallback(async () => {
    if (!session.agent || !world || !loaded || saving) return;
    if (current && mapChoice !== npcMapId(current)) { setNote('移動先を選ぶか、移動先選びをやめてから保存してください'); return; }
    // クエストが発注させている NPC を消させない (#423 / #603) — 参照切れの NPC が 1 人でも
    // いると setGameQuests が全体を落とし、消した NPC と無関係な全クエストまで web/edge から消える。
    const dangling = danglingRefs('npc', list.map((n) => n.id))[0];
    if (dangling) {
      setNote(describeDanglingRef(dangling));
      return;
    }
    for (const n of list) {
      const previous = snapshot.find((old) => old.id === n.id);
      const err = npcStructuralPlacementError(world, n) ?? ((!previous || !sameNpcPosition(n, previous)) ? validateNpcPlacement(world, n, list).reason : null);
      if (err) { setNote(`保存できない: ${err}`); return; }
    }
    setSaving(true);
    try {
      await saveNpcs(session.agent, list);
      setSnapshot(structuredClone(list)); additions.current.clear();
      setNote(`${list.length} 人を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(e instanceof NpcDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
    } finally { setSaving(false); }
  }, [session.agent, list, world, loaded, saving, current, mapChoice, snapshot]);

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

  const placeNote = (n: NpcDef): string | null => world ? validateNpcPlacement(world, n, list).reason ?? null : null;
  const mapLabel = (mapId: string | undefined): string => !mapId || mapId === WORLD_MAP_ID ? 'フィールド' : interiors.find((m) => m.id === mapId)?.name ?? mapId;
  if (!loaded || !world) return <div className="npc-editor"><p role="status">{note ?? '地図とNPCを読み込んでいます…'}</p>{loadState === 'error' && <button type="button" onClick={() => setRetry((v) => v + 1)}>再試行</button>}<p><Link to="/admin">← 管理</Link></p></div>;

  return (
    <div className="admin-page npc-editor">
      <fieldset disabled={saving}>
      <div className="admin-head">
        <Link to="/admin" onClick={(e) => { if (saving || (dirty && !window.confirm('未保存の変更を破棄して戻りますか？'))) e.preventDefault(); }} style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>NPC</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{list.length} 人</span>
        <button type="button" onClick={add} style={{ fontSize: '0.85em' }}>＋NPC</button>
        <button type="button" onClick={insertVillagers} style={{ fontSize: '0.85em' }}>ふたばの村の村人を入れる</button>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || !loaded} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={!dirty} onClick={cancelAll}>未保存の変更を取り消す</button>
      </div>

      {note && <p role="status" style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => choose(n)}
              style={{
                display: 'flex', gap: '0.4em', width: '100%', padding: '0.2em 0.4em',
                fontSize: '0.85em', textAlign: 'left',
                border: sel === n.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{n.name}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
                {n.mapId && n.mapId !== WORLD_MAP_ID ? `${mapLabel(n.mapId)} ` : ''}({n.x},{n.y})
              </span>
            </button>
          ))}
          {list.length === 0 && (
            <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>まだ居ない。「＋NPC」で置く</span>
          )}
        </div>

        {current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
              <strong>{current.name}</strong>
              <code style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{current.id}</code>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.3em' }}>
                <button type="button" onClick={() => {
                    if (drawing) {
                      const arts = new Map(world.arts); const art = tileArtFor(npcArtKey(current.id));
                      if (art) arts.set(npcArtKey(current.id), structuredClone(art));
                      setWorld({ ...world, arts });
                    }
                    setDrawing((v) => !v);
                  }} style={{ fontSize: '0.8em' }}>
                  {drawing ? '絵を閉じる' : '絵をかく'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(`「${current.name}」を消す？`)) return;
                    setList((xs) => xs.filter((n) => n.id !== current.id));
                    setSel(null);
                  }}
                  style={{ fontSize: '0.8em' }}
                >
                  削除
                </button>
              </span>
            </div>
            {field('なまえ', <input value={current.name} onChange={(e) => update(current.id, { name: e.target.value })} />)}
            <div>
              <p style={{ fontSize: '0.8em' }}>見た目（選んでから「保存」で反映）</p>
              <div className="npc-presets" role="group" aria-label="標準の絵">
                {NPC_SPRITE_PRESETS.map((preset) => <button type="button" key={preset.id} aria-pressed={current.spritePreset === preset.id} onClick={() => update(current.id, { spritePreset: preset.id })}>
                  <svg viewBox="0 0 32 32" aria-hidden="true"><NpcSprite npc={{ id: current.id, spritePreset: preset.id }} /></svg>
                  <span>{preset.name}</span>
                  {current.spritePreset === preset.id && <span>{snapshot.find((n) => n.id === current.id)?.spritePreset === preset.id ? '使用中' : '未保存'}</span>}
                </button>)}
              </div>
              <button type="button" disabled={!current.spritePreset} onClick={() => setList((xs) => xs.map((n) => { if (n.id !== current.id) return n; const next = { ...n }; delete next.spritePreset; return next; }))}>
                {world.arts.has(npcArtKey(current.id)) ? '手描きの絵を使う' : '従来の表示に戻す'}
              </button>
              {!current.spritePreset && <p className="npc-map-help">{world.arts.has(npcArtKey(current.id)) ? '手描きの絵' : '従来の表示'}{snapshot.find((n) => n.id === current.id)?.spritePreset ? '（未保存）' : 'を使用中'}</p>}
            </div>
            {field('マップ', (
              <select aria-label="マップ" value={mapChoice} onChange={(e) => setMapChoice(e.target.value)}>
                <option value={WORLD_MAP_ID}>フィールド</option>
                {interiors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                {mapChoice !== WORLD_MAP_ID && !interiors.some((m) => m.id === mapChoice) && <option value={mapChoice}>{mapChoice}（存在しない）</option>}
              </select>
            ))}
            {mapChoice !== npcMapId(current) && <p role="status">移動先のマスを選んでください。まだ移動していません。<button type="button" onClick={() => setMapChoice(npcMapId(current))}>移動先選びをやめる</button></p>}
            <NpcPlacementMap key={`${current.id}/${mapChoice}`} world={world} npc={current} draft={list} mapId={mapChoice} onPlace={(position) => update(current.id, position)} />
            <p className="npc-map-help">現在の配置: {mapLabel(current.mapId)} ({current.x}, {current.y}){!snapshot.some((n) => n.id === current.id && sameNpcPosition(n, current)) ? ' · 未保存' : ''}</p>
            <button type="button" onClick={() => {
              const original = snapshot.find((n) => n.id === current.id) ?? additions.current.get(current.id);
              if (original) { update(current.id, { mapId: original.mapId ?? WORLD_MAP_ID, x: original.x, y: original.y }); setMapChoice(npcMapId(original)); }
            }}>位置を戻す</button>
            <details className="npc-coordinates"><summary>座標で微調整</summary>
              <label>x <input aria-label="配置x" type="number" value={coords.x} onChange={(e) => setCoords((v) => ({ ...v, x: e.target.value }))} /></label>
              <label>y <input aria-label="配置y" type="number" value={coords.y} onChange={(e) => setCoords((v) => ({ ...v, y: e.target.value }))} /></label>
              <button type="button" onClick={() => {
                if (!coords.x.trim() || !coords.y.trim()) { setNote('xとyを両方入力してください'); return; }
                const result = validateNpcPlacement(world, { ...current, mapId: mapChoice, x: Number(coords.x), y: Number(coords.y) }, list);
                if (result.reason) setNote(result.reason);
                else if (result.position) { update(current.id, result.position); setNote('位置を変更しました。未保存です'); }
              }}>この座標へ移す</button>
            </details>
            {placeNote(current) && (
              <p style={{ fontSize: '0.8em', color: 'var(--color-danger)', margin: 0 }}>{placeNote(current)}</p>
            )}
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>セリフ (1 行 = 1 窓。ぶつかると先頭から流れる)</span>
              {current.lines.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.3em', margin: '0.15em 0' }}>
                  <input
                    value={l}
                    onChange={(e) => update(current.id, { lines: current.lines.map((x, j) => (j === i ? e.target.value : x)) })}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    disabled={current.lines.length <= 1}
                    onClick={() => update(current.id, { lines: current.lines.filter((_, j) => j !== i) })}
                    style={{ fontSize: '0.8em' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update(current.id, { lines: [...current.lines, ''] })}
                style={{ fontSize: '0.8em', marginTop: '0.2em' }}
              >
                ＋セリフ
              </button>
            </div>
            {/* フラグ別セリフ (#545)。上から見て最初に条件を満たしたものを話す。 */}
            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>
                フラグ別セリフ (上から見て最初に条件を満たしたもの。どれも満たさなければ上のセリフ)
              </span>
              {(current.altLines ?? []).map((alt, ai) => (
                <div key={ai} style={{ border: '1px solid var(--color-border)', padding: '0.3em', margin: '0.2em 0' }}>
                  <div style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--color-muted)' }}>立っている</span>
                    <input
                      value={(alt.flags ?? []).join(' ')}
                      placeholder="flag_a flag_b"
                      onChange={(e) => {
                        const flags = e.target.value.split(/\s+/).filter(Boolean);
                        update(current.id, { altLines: (current.altLines ?? []).map((x, j) => (j === ai ? { ...x, flags } : x)) });
                      }}
                      style={{ width: '11em', fontFamily: 'ui-monospace, monospace' }}
                    />
                    <span style={{ color: 'var(--color-muted)' }}>立っていない</span>
                    <input
                      value={(alt.notFlags ?? []).join(' ')}
                      placeholder="flag_c"
                      onChange={(e) => {
                        const notFlags = e.target.value.split(/\s+/).filter(Boolean);
                        update(current.id, { altLines: (current.altLines ?? []).map((x, j) => (j === ai ? { ...x, notFlags } : x)) });
                      }}
                      style={{ width: '9em', fontFamily: 'ui-monospace, monospace' }}
                    />
                    <span style={{ color: 'var(--color-muted)' }}>持っている</span>
                    <ItemReqInput
                      value={alt.items}
                      placeholder="(なし) 例: gate-key"
                      onChange={(items) => update(current.id, {
                        altLines: (current.altLines ?? []).map((x, j) => {
                          if (j !== ai) return x;
                          if (!items) { const { items: _i, ...rest } = x; return rest; }
                          return { ...x, items };
                        }),
                      })}
                    />
                    <button
                      type="button"
                      onClick={() => update(current.id, { altLines: (current.altLines ?? []).filter((_, j) => j !== ai) })}
                      style={{ marginLeft: 'auto', fontSize: '0.8em' }}
                    >
                      この分岐を消す
                    </button>
                  </div>
                  {alt.lines.map((l, li) => (
                    <div key={li} style={{ display: 'flex', gap: '0.3em', margin: '0.15em 0' }}>
                      <input
                        value={l}
                        onChange={(e) => update(current.id, {
                          altLines: (current.altLines ?? []).map((x, j) => (j === ai ? { ...x, lines: x.lines.map((y, k) => (k === li ? e.target.value : y)) } : x)),
                        })}
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        disabled={alt.lines.length <= 1}
                        onClick={() => update(current.id, {
                          altLines: (current.altLines ?? []).map((x, j) => (j === ai ? { ...x, lines: x.lines.filter((_, k) => k !== li) } : x)),
                        })}
                        style={{ fontSize: '0.8em' }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => update(current.id, {
                      altLines: (current.altLines ?? []).map((x, j) => (j === ai ? { ...x, lines: [...x.lines, ''] } : x)),
                    })}
                    style={{ fontSize: '0.8em' }}
                  >
                    ＋セリフ
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update(current.id, { altLines: [...(current.altLines ?? []), { flags: [], lines: ['…'] }] })}
                style={{ fontSize: '0.8em', marginTop: '0.2em' }}
              >
                ＋フラグ別セリフ
              </button>
            </div>
            {drawing && (
              <div>{current.spritePreset && <p className="npc-map-help">標準の絵を使用中。手描きを保存した後、絵を閉じて「手描きの絵を使う」で切り替え、NPCを保存してください。</p>}
              <p className="npc-map-help">「絵を保存」はNPC保存とは別です。NPCの変更取消では保存済みの絵は戻りません。</p><TileArtEditor
                subjects={[{
                  key: npcArtKey(current.id),
                  name: current.name,
                  seedColor: '#4a6fb3',
                } satisfies ArtSubject]}
              /></div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか「＋NPC」。</div>
        )}
      </div>
      </fieldset>
    </div>
  );
}
