import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  allNpcs,
  gameQuests,
  isWalkableAt,
  npcArtKey,
  NpcDataError,
  setNpcs,
  townAt,
  worldOverlay,
  type NpcDef,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveNpcs } from '@/lib/world-authoring';
import { TileArtEditor, type ArtSubject } from '@/components/admin/tile-art-editor';
import { ItemReqInput } from '@/components/admin/item-req-input';

/**
 * **NPC エディタ** (#425)。位置・名前・セリフ・絵。
 *
 * NPC はタイルを 1 つ占め、**歩いてぶつかると会話が始まる** (移動判定でも塞ぐ =
 * web と edge の両方が同じ一覧を読む)。絵はドット絵 (`npc:<id>`)、無ければ代替の人形。
 */
export function AdminNpcs() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<NpcDef[]>(() => allNpcs().map((n) => ({ ...n, lines: [...n.lines] })));
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const current = useMemo(() => list.find((n) => n.id === sel) ?? null, [list, sel]);

  const update = useCallback((id: string, patch: Partial<NpcDef>) => {
    setList((xs) => xs.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    setDirty(true);
  }, []);

  const add = useCallback(() => {
    // spawn の隣に置いて始める (座標を手で探させない)。空いているマスを探す。
    const sp = worldOverlay().spawn;
    let x = sp.x + 1;
    let y = sp.y;
    while (list.some((n) => n.x === x && n.y === y)) x++;
    let i = list.length + 1;
    while (list.some((n) => n.id === `npc-${i}`)) i++;
    const npc: NpcDef = { id: `npc-${i}`, name: 'むらびと', x, y, lines: ['こんにちは、たびのひと。'] };
    setList((xs) => [...xs, npc]);
    setSel(npc.id);
    setDirty(true);
  }, [list]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    // クエストが発注させている NPC を消させない (#423。実装レビュー ★★) —
    // 参照切れの NPC が 1 人でもいると setGameQuests が全体を落とす設計なので、
    // 消した NPC と無関係な全クエストまで web/edge から消えてしまう。
    const orphan = gameQuests().find((q) => !list.some((n) => n.id === q.npcId));
    if (orphan) {
      setNote(`保存できない: クエスト「${orphan.title}」が NPC (${orphan.npcId}) に発注させている。先にクエストを消すか発注者を変える`);
      return;
    }
    try {
      await saveNpcs(session.agent, list);
      setDirty(false);
      setNote(`${list.length} 人を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(e instanceof NpcDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
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

  const field = (label: string, input: React.ReactNode) => (
    <label className="admin-field">
      <span>{label}</span>
      {input}
    </label>
  );

  const placeNote = (n: NpcDef): string | null => {
    // 置き場所の落とし穴を可視化する。保存は拒否しない (意図的な配置がありうる) が、
    // 「海の上の人」「街の入口を塞ぐ人」は大抵ミスなので気づけるようにする。
    if (!isWalkableAt(n.x, n.y)) return '⚠ 歩けないマスの上にいる (だれもぶつかれない = 話せない)';
    const t = townAt(n.x, n.y);
    if (t) return `⚠ 街 (${t.name}) のマスに重なっている (入口を塞ぐ)`;
    return null;
  };

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>NPC</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{list.length} 人</span>
        <button type="button" onClick={add} style={{ fontSize: '0.85em' }}>＋NPC</button>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSel(n.id)}
              style={{
                display: 'flex', gap: '0.4em', width: '100%', padding: '0.2em 0.4em',
                fontSize: '0.85em', textAlign: 'left',
                border: sel === n.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{n.name}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>({n.x},{n.y})</span>
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
                <button type="button" onClick={() => setDrawing((v) => !v)} style={{ fontSize: '0.8em' }}>
                  {drawing ? '絵を閉じる' : '絵をかく'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    if (!window.confirm(`「${current.name}」を消す？`)) return;
                    setList((xs) => xs.filter((n) => n.id !== current.id));
                    setSel(null);
                    setDirty(true);
                  }}
                  style={{ fontSize: '0.8em' }}
                >
                  削除
                </button>
              </span>
            </div>
            {field('なまえ', <input value={current.name} onChange={(e) => update(current.id, { name: e.target.value })} />)}
            {field('位置', (
              <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center' }}>
                x
                <input type="number" value={current.x} onChange={(e) => update(current.id, { x: Number(e.target.value) })} style={{ width: '5.5em' }} />
                y
                <input type="number" value={current.y} onChange={(e) => update(current.id, { y: Number(e.target.value) })} style={{ width: '5.5em' }} />
                <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>マップエディタの座標表示と同じ</span>
              </span>
            ))}
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
              <TileArtEditor
                subjects={[{
                  key: npcArtKey(current.id),
                  name: current.name,
                  seedColor: '#4a6fb3',
                } satisfies ArtSubject]}
              />
            )}
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか「＋NPC」。</div>
        )}
      </div>
    </div>
  );
}
