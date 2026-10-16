import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DIALOGUE_SCENE_IDS, type DialogueScene, type NpcDef, type SceneLine } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadDialogueAuthoringRecords, saveDialogue } from '@/lib/world-authoring';
import { AuthoredWorldGate } from '@/components/admin/authored-world-gate';
import { DialogueLineEditor } from '@/components/admin/dialogue-line-editor';
import { DialogueScenePreview, SCENE_GROUPS, sceneLabel, sceneVars } from '@/components/admin/dialogue-scene-list';

/**
 * **会話エディタ** (D-DIALOGUE-006 §5)。冒頭・ギルド・宿屋・なんでも屋の場面ごとのセリフ。
 * どの場面をいつ出すかはコードが決め、文はここで書く (保存先は管理者 PDS の world.dialogue)。
 * 読み込めなければ保存させない。決まった場面がすべて埋まるまで保存できない。
 */
export function AdminDialogue() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [scenes, setScenes] = useState<DialogueScene[]>([]);
  const [npcs, setNpcList] = useState<NpcDef[]>([]);
  const [sel, setSel] = useState<string>(DIALOGUE_SCENE_IDS[0]);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [overrideNpc, setOverrideNpc] = useState('');

  useEffect(() => {
    let cancelled = false;
    const agent = session.agent, did = getPrimaryAdminDid();
    if (!admin || !agent || !did) { setLoadState('failed'); return; }
    void loadDialogueAuthoringRecords(agent, did).then(({ npcs: list, dialogue }) => {
      if (cancelled) return;
      // レコードが無ければ空の場面から始める (全部埋めるまで保存できない)。
      const loaded = dialogue?.scenes ?? [];
      setScenes([...DIALOGUE_SCENE_IDS.filter((id) => !loaded.some((s) => s.id === id)).map((id) => ({ id, lines: [] })), ...structuredClone(loaded)]);
      setNpcList(list); setLoadState('ok');
    }).catch((e: unknown) => {
      if (cancelled) return;
      setLoadState('failed'); setNote(`保存済みの会話を読み込めなかった。上書きで消える恐れがあるので保存できない (${String(e)})`);
    });
    return () => { cancelled = true; };
  }, [session.agent, admin]);

  const current = scenes.find((s) => s.id === sel) ?? null;
  const receptions = useMemo(() => npcs.filter((n) => n.guildReception), [npcs]);
  const setLines = (lines: SceneLine[]) => { setScenes((xs) => xs.map((s) => (s.id === sel ? { ...s, lines } : s))); setDirty(true); };
  const addOverride = () => {
    const id = `guild.first:${overrideNpc}`;
    if (!overrideNpc || scenes.some((s) => s.id === id)) return;
    setScenes((xs) => [...xs, { id, lines: structuredClone(xs.find((s) => s.id === 'guild.first')?.lines ?? []) }]);
    setSel(id); setDirty(true);
  };
  const save = async () => {
    if (!session.agent || loadState !== 'ok') return;
    try {
      await saveDialogue(session.agent, { scenes }, new Set(npcs.map((n) => n.id)));
      setDirty(false); setNote(`${scenes.length} 場面を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) { setNote(`保存できない: ${e instanceof Error ? e.message : String(e)}`); }
  };

  if (!admin) return <div style={{ padding: '1em' }}><p>この画面は管理者だけが使えます。</p><Link to="/admin">管理ダッシュボードへ</Link></div>;
  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>会話</strong>
        <button type="button" onClick={() => void save()} disabled={!dirty || loadState !== 'ok'} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>保存</button>
      </div>
      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}
      <AuthoredWorldGate loaded={loadState === 'ok'}>
        <div className="admin-cols">
          <nav aria-label="場面一覧" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.85em', maxHeight: '72vh', overflowY: 'auto' }}>
            {SCENE_GROUPS.map((g) => (
              <div key={g.title}>
                <div style={{ color: 'var(--color-muted)', marginTop: '0.3em' }}>{g.title}</div>
                {scenes.filter((s) => g.match(s.id)).map((s) => (
                  <button key={s.id} type="button" aria-pressed={s.id === sel} onClick={() => setSel(s.id)}
                    style={{ display: 'flex', width: '100%', textAlign: 'left', background: 'transparent', border: s.id === sel ? '2px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                    <span style={{ flex: 1 }}>{sceneLabel(s.id, npcs)}</span><span style={{ color: 'var(--color-muted)' }}>{s.lines.length}行</span>
                  </button>
                ))}
                {g.title === 'ギルド' && (
                  <div style={{ display: 'flex', gap: '0.2em', marginTop: '0.2em' }}>
                    <select aria-label="上書きする受付" value={overrideNpc} onChange={(e) => setOverrideNpc(e.target.value)}>
                      <option value="">受付を選ぶ</option>
                      {receptions.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                    <button type="button" disabled={!overrideNpc} onClick={addOverride}>＋受付ごとの上書き</button>
                  </div>
                )}
              </div>
            ))}
          </nav>
          {current && (
            <section aria-label={sceneLabel(current.id, npcs)}>
              <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{sceneLabel(current.id, npcs)}</strong><code style={{ fontSize: '0.75em' }}>{current.id}</code>
                <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>差し込み: {sceneVars(current.id.split(':')[0]!)}</span>
                <button type="button" onClick={() => setPreview(true)} disabled={current.lines.length === 0} style={{ marginLeft: 'auto' }}>プレビュー</button>
                {current.id.includes(':') && <button type="button" className="secondary" onClick={() => { setScenes((xs) => xs.filter((s) => s.id !== current.id)); setSel('guild.first'); setDirty(true); }}>上書きを消す</button>}
              </div>
              {current.lines.map((l, i) => (
                <DialogueLineEditor key={i} line={l} index={i} count={current.lines.length} npcs={npcs}
                  onChange={(next) => setLines(current.lines.map((x, j) => (j === i ? next : x)))}
                  onMove={(d) => { const xs = [...current.lines]; [xs[i], xs[i + d]] = [xs[i + d]!, xs[i]!]; setLines(xs); }}
                  onDelete={() => setLines(current.lines.filter((_, j) => j !== i))} />
              ))}
              <button type="button" onClick={() => setLines([...current.lines, { text: '' }])}>＋行</button>
              {preview && <DialogueScenePreview scene={current} npcs={npcs} onDone={() => setPreview(false)} />}
            </section>
          )}
        </div>
      </AuthoredWorldGate>
    </div>
  );
}
