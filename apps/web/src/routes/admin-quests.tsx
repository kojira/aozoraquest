import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  allNpcs,
  gameQuests,
  ITEMS,
  MONSTERS,
  QuestDataError,
  setGameQuests,
  type GameQuestDef,
  type QuestObjective,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { isAdminDid } from '@/lib/runtime-config';
import { saveGameQuests } from '@/lib/world-authoring';

/**
 * **ゲーム内クエスト エディタ** (#423)。NPC 発注・達成条件・報酬。
 *
 * 達成条件は**サーバーが検証できるもの**だけ (討伐数 / 素材の所持)。進行と報酬は
 * edge が権威なので、ここで作った定義は保存 → サーバーが最大 5 分で拾ってから効く。
 */
export function AdminQuests() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<GameQuestDef[]>(() =>
    gameQuests().map((q) => ({ ...q, intro: [...q.intro], done: [...q.done], ...(q.progress ? { progress: [...q.progress] } : {}) })),
  );
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const npcs = useMemo(() => allNpcs(), []);
  const monsters = useMemo(() => [...MONSTERS].sort((a, b) => a.tier - b.tier), []);
  const items = useMemo(() => Object.entries(ITEMS).map(([id, v]) => ({ id, name: v.name })), []);
  const current = useMemo(() => list.find((q) => q.id === sel) ?? null, [list, sel]);

  const update = useCallback((id: string, patch: Partial<GameQuestDef>) => {
    setList((xs) => xs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    setDirty(true);
  }, []);

  const add = useCallback(() => {
    let i = list.length + 1;
    while (list.some((q) => q.id === `quest-${i}`)) i++;
    const q: GameQuestDef = {
      id: `quest-${i}`,
      title: 'あたらしい たのまれごと',
      npcId: npcs[0]?.id ?? '',
      intro: ['たのみが あるんだ。'],
      done: ['ありがとう!'],
      objective: { kind: 'defeat', monsterId: monsters[0]?.id ?? '', count: 3 },
      reward: { power: 5 },
    };
    setList((xs) => [...xs, q]);
    setSel(q.id);
    setDirty(true);
  }, [list, npcs, monsters]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveGameQuests(session.agent, list);
      setDirty(false);
      setNote(`${list.length} 件を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      // 検証で落ちたら現在のメモリ状態が壊れている可能性があるので元に戻す
      try { setGameQuests(null); } catch { /* noop */ }
      setNote(e instanceof QuestDataError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
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
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.8em' }}>
      <span style={{ width: '6em', color: 'var(--color-muted)' }}>{label}</span>
      {input}
    </label>
  );

  const lineEditor = (q: GameQuestDef, key: 'intro' | 'done' | 'progress', label: string, hint: string) => {
    const lines = q[key] ?? [];
    const set = (next: string[]) => {
      if (key === 'progress' && next.length === 0) {
        // exactOptionalPropertyTypes: 空にしたら省略 (既定セリフに戻す)
        setList((xs) => xs.map((x) => {
          if (x.id !== q.id) return x;
          const { progress: _p, ...rest } = x;
          return rest as GameQuestDef;
        }));
        setDirty(true);
      } else {
        update(q.id, { [key]: next } as Partial<GameQuestDef>);
      }
    };
    return (
      <div style={{ fontSize: '0.8em' }}>
        <span style={{ color: 'var(--color-muted)' }}>{label} ({hint})</span>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.3em', margin: '0.15em 0' }}>
            <input value={l} onChange={(e) => set(lines.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1 }} />
            <button
              type="button"
              disabled={key !== 'progress' && lines.length <= 1}
              onClick={() => set(lines.filter((_, j) => j !== i))}
              style={{ fontSize: '0.8em' }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => set([...lines, ''])} style={{ fontSize: '0.8em', marginTop: '0.2em' }}>
          ＋セリフ
        </button>
      </div>
    );
  };

  const npcNameOf = (id: string) => npcs.find((n) => n.id === id)?.name ?? id;

  return (
    <div style={{ padding: '0.8em', maxWidth: 900 }}>
      <div style={{ display: 'flex', gap: '0.6em', alignItems: 'center', marginBottom: '0.4em' }}>
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>クエスト</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{list.length} 件</span>
        <button type="button" onClick={add} disabled={npcs.length === 0} style={{ fontSize: '0.85em' }}>＋クエスト</button>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}
      {npcs.length === 0 && (
        <p style={{ fontSize: '0.8em', color: 'var(--color-danger)' }}>
          発注する NPC がまだ居ない。先に <Link to="/admin/npcs">NPC</Link> を置く
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 2fr', gap: '0.8em' }}>
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setSel(q.id)}
              style={{
                display: 'flex', gap: '0.4em', width: '100%', padding: '0.2em 0.4em',
                fontSize: '0.85em', textAlign: 'left',
                border: sel === q.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
                background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{q.title}</span>
              <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{npcNameOf(q.npcId)}</span>
            </button>
          ))}
          {list.length === 0 && (
            <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>まだ無い。「＋クエスト」で作る</span>
          )}
        </div>

        {current ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            <div style={{ display: 'flex', gap: '0.4em', alignItems: 'center' }}>
              <strong>{current.title}</strong>
              <code style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{current.id}</code>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!window.confirm(`「${current.title}」を消す？`)) return;
                  setList((xs) => xs.filter((q) => q.id !== current.id));
                  setSel(null);
                  setDirty(true);
                }}
                style={{ marginLeft: 'auto', fontSize: '0.8em' }}
              >
                削除
              </button>
            </div>
            {field('タイトル', <input value={current.title} onChange={(e) => update(current.id, { title: e.target.value })} style={{ flex: 1 }} />)}
            {field('発注 NPC', (
              <select value={current.npcId} onChange={(e) => update(current.id, { npcId: e.target.value })}>
                {npcs.map((n) => (
                  <option key={n.id} value={n.id}>{n.name} ({n.x},{n.y})</option>
                ))}
              </select>
            ))}
            {field('条件', (
              <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={current.objective.kind}
                  onChange={(e) => {
                    const kind = e.target.value as QuestObjective['kind'];
                    const count = current.objective.count;
                    update(current.id, {
                      objective: kind === 'defeat'
                        ? { kind, monsterId: monsters[0]?.id ?? '', count }
                        : { kind, itemId: items[0]?.id ?? '', count },
                    });
                  }}
                >
                  <option value="defeat">たおす</option>
                  <option value="collect">あつめる (素材を渡す)</option>
                </select>
                {current.objective.kind === 'defeat' ? (
                  <select
                    value={current.objective.monsterId}
                    onChange={(e) => update(current.id, { objective: { ...current.objective, monsterId: e.target.value } as QuestObjective })}
                  >
                    {monsters.map((m) => (
                      <option key={m.id} value={m.id}>T{m.tier} {m.name}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={current.objective.itemId}
                    onChange={(e) => update(current.id, { objective: { ...current.objective, itemId: e.target.value } as QuestObjective })}
                  >
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                  </select>
                )}
                ×
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={current.objective.count}
                  onChange={(e) => update(current.id, { objective: { ...current.objective, count: Number(e.target.value) } as QuestObjective })}
                  style={{ width: '4.5em' }}
                />
              </span>
            ))}
            {field('報酬', (
              <span style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap' }}>
                パワー
                <input
                  type="number"
                  min={0}
                  value={current.reward?.power ?? 0}
                  onChange={(e) => {
                    const power = Number(e.target.value);
                    const base = { ...(current.reward ?? {}) };
                    if (power > 0) base.power = power;
                    else delete base.power;
                    update(current.id, Object.keys(base).length ? { reward: base } : ({ reward: undefined } as unknown as Partial<GameQuestDef>));
                  }}
                  style={{ width: '5em' }}
                />
                アイテム
                <select
                  value={current.reward?.itemId ?? ''}
                  onChange={(e) => {
                    const itemId = e.target.value;
                    const base = { ...(current.reward ?? {}) };
                    if (itemId) { base.itemId = itemId; base.count = base.count && base.count > 0 ? base.count : 1; }
                    else { delete base.itemId; delete base.count; }
                    update(current.id, Object.keys(base).length ? { reward: base } : ({ reward: undefined } as unknown as Partial<GameQuestDef>));
                  }}
                >
                  <option value="">なし</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.name}</option>
                  ))}
                </select>
                {current.reward?.itemId && (
                  <>
                    ×
                    <input
                      type="number"
                      min={1}
                      value={current.reward?.count ?? 1}
                      onChange={(e) => update(current.id, { reward: { ...(current.reward ?? {}), count: Number(e.target.value) } })}
                      style={{ width: '4.5em' }}
                    />
                  </>
                )}
              </span>
            ))}
            {lineEditor(current, 'intro', '依頼のセリフ', '読み終えると受注する')}
            {lineEditor(current, 'progress', '進行中のセリフ', '空なら既定「たのんだよ。」+ サーバーの「まだ n/m」')}
            {lineEditor(current, 'done', '達成のセリフ', 'お礼。この後に報酬が出る')}
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか「＋クエスト」。</div>
        )}
      </div>
    </div>
  );
}
