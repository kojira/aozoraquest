import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ITEMS,
  JOBS,
  MAX_NOTICE_LEN,
  ScenarioError,
  gameQuests,
  jobDisplayName,
  scenarioEvents,
  SAMPLE_SCENARIO,
  type Archetype,
  type ScenarioCondition,
  type ScenarioEvent,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { getPrimaryAdminDid, isAdminDid } from '@/lib/runtime-config';
import { loadAuthoredWorld, loadScenarioRecord, saveScenario } from '@/lib/world-authoring';

/**
 * **シナリオエディタ** (#545)。進行を「条件が揃ったらフラグが立つ」の列で書く。
 *
 * 粒度は **(a) イベント列**。立ったフラグで NPC のセリフ (altLines) と
 * クエストの解禁 (requireFlags) が変わる。選択肢つき会話や章ごとの地域解禁は
 * この土台の上に後から乗せる。
 *
 * **フラグを立てるのはサーバー** — ここは「いつ立つか」の定義を書くだけ。
 */

const KIND_LABELS: Record<ScenarioCondition['kind'], string> = {
  questDone: 'クエスト達成',
  flag: 'フラグが立っている',
  notFlag: 'フラグが立っていない',
  jobLevel: 'ジョブ Lv 以上',
  itemCount: 'アイテム所持',
};

export function AdminScenario() {
  const session = useSession();
  const admin = isAdminDid(session.did ?? null);
  const [list, setList] = useState<ScenarioEvent[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'failed'>('loading');

  const quests = useMemo(() => gameQuests(), [loadState]);
  const items = useMemo(() => Object.entries(ITEMS).map(([id, v]) => ({ id, name: v.name })), []);

  // 保存済みを読めなければ保存させない (空で上書きすると全部消える)。
  useEffect(() => {
    let cancelled = false;
    const agent = session.agent;
    const adminDid = getPrimaryAdminDid();
    if (!agent || !adminDid) { setLoadState('failed'); return; }
    // **クエストを先に読む** — 条件が questId の実在を引くので、直接開くと
    // 「クエストが存在しない」で読み込みが落ち、正常なレコードなのに保存不能になる。
    void loadAuthoredWorld(agent)
      .then(() => loadScenarioRecord(agent, adminDid))
      .then((events) => {
        if (cancelled) return;
        setList(events.map((e) => ({ ...e, when: e.when.map((c) => ({ ...c })), setFlags: [...e.setFlags] })));
        setLoadState('ok');
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[admin] scenario load failed', e);
        setLoadState('failed');
        setNote('保存済みのシナリオを読み込めなかった。上書きで消える恐れがあるので保存できない');
      });
    return () => { cancelled = true; };
  }, [session.agent]);

  const current = useMemo(() => list.find((e) => e.id === sel) ?? null, [list, sel]);
  const update = useCallback((id: string, patch: Partial<ScenarioEvent>) => {
    setList((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  }, []);

  /** 既に定義されているフラグ (打ち間違い防止に候補として出す)。 */
  const knownFlags = useMemo(() => [...new Set(list.flatMap((e) => e.setFlags))].sort(), [list]);

  const add = useCallback(() => {
    let i = list.length + 1;
    while (list.some((e) => e.id === `ev-${i}`)) i++;
    const ev: ScenarioEvent = { id: `ev-${i}`, title: 'あたらしいイベント', when: [], setFlags: [`flag_${i}`] };
    setList((xs) => [...xs, ev]);
    setSel(ev.id);
    setDirty(true);
  }, [list]);

  const save = useCallback(async () => {
    if (!session.agent) return;
    try {
      await saveScenario(session.agent, list);
      setDirty(false);
      setNote(`${list.length} 件を保存した。サーバーは最大 5 分で拾う`);
    } catch (e) {
      setNote(e instanceof ScenarioError ? `保存できない: ${e.message}` : `保存できなかった: ${String(e)}`);
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

  /** 条件 1 行の編集 UI。種類で必要な入力が変わる。 */
  const condRow = (ev: ScenarioEvent, c: ScenarioCondition, i: number) => {
    const setCond = (next: ScenarioCondition) => update(ev.id, { when: ev.when.map((x, j) => (j === i ? next : x)) });
    return (
      <div key={i} style={{ display: 'flex', gap: '0.3em', alignItems: 'center', flexWrap: 'wrap', margin: '0.15em 0' }}>
        <select
          value={c.kind}
          onChange={(e) => {
            const kind = e.target.value as ScenarioCondition['kind'];
            // 種類を変えたら、その種類に要るフィールドだけを持つ条件に作り直す
            // (古いフィールドが残ると検証で落ちる)。
            if (kind === 'questDone') setCond({ kind, questId: quests[0]?.id ?? '' });
            else if (kind === 'flag' || kind === 'notFlag') setCond({ kind, flag: knownFlags[0] ?? 'flag_1' });
            else if (kind === 'jobLevel') setCond({ kind, job: JOBS[0]!.id, level: 5 });
            else setCond({ kind, itemId: items[0]?.id ?? '', count: 1 });
          }}
        >
          {(Object.keys(KIND_LABELS) as ScenarioCondition['kind'][]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>

        {c.kind === 'questDone' && (
          <select value={c.questId} onChange={(e) => setCond({ ...c, questId: e.target.value })}>
            {quests.length === 0 && <option value="">(クエストが無い)</option>}
            {quests.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </select>
        )}
        {(c.kind === 'flag' || c.kind === 'notFlag') && (
          <input
            value={c.flag}
            list="known-flags"
            onChange={(e) => setCond({ ...c, flag: e.target.value })}
            style={{ width: '11em', fontFamily: 'ui-monospace, monospace' }}
          />
        )}
        {c.kind === 'jobLevel' && (
          <>
            <select value={c.job} onChange={(e) => setCond({ ...c, job: e.target.value as Archetype })}>
              {JOBS.map((j) => <option key={j.id} value={j.id}>{jobDisplayName(j.id, 'default')}</option>)}
            </select>
            Lv<input type="number" min={1} max={99} value={c.level} onChange={(e) => setCond({ ...c, level: Number(e.target.value) })} style={{ width: '4.5em' }} />
          </>
        )}
        {c.kind === 'itemCount' && (
          <>
            <select value={c.itemId} onChange={(e) => setCond({ ...c, itemId: e.target.value })}>
              {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            ×<input type="number" min={1} value={c.count} onChange={(e) => setCond({ ...c, count: Number(e.target.value) })} style={{ width: '4.5em' }} />
          </>
        )}
        <button type="button" onClick={() => update(ev.id, { when: ev.when.filter((_, j) => j !== i) })} style={{ fontSize: '0.8em' }}>×</button>
      </div>
    );
  };

  return (
    <div className="admin-page" style={{ padding: '0.8em' }}>
      <datalist id="known-flags">
        {knownFlags.map((f) => <option key={f} value={f} />)}
      </datalist>

      <div className="admin-head">
        <Link to="/admin" style={{ fontSize: '0.8em' }}>← 管理</Link>
        <strong>シナリオ</strong>
        <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{list.length} 件 / フラグ {knownFlags.length}</span>
        <button type="button" onClick={add} style={{ fontSize: '0.85em' }}>＋イベント</button>
        <button
          type="button"
          onClick={() => {
            // 既にあるものと id が衝突しないよう連番を振り直す。
            let n = 1;
            const taken = new Set(list.map((e) => e.id));
            const add = SAMPLE_SCENARIO.map((e) => {
              let id = e.id;
              while (taken.has(id)) id = `${e.id}-${++n}`;
              taken.add(id);
              return { ...e, id, when: e.when.map((c) => ({ ...c })), setFlags: [...e.setFlags] };
            });
            setList((xs) => [...xs, ...add]);
            setSel(add[0]!.id);
            setDirty(true);
            setNote('3 つ繋がったサンプルを入れた。保存すると遊べる (NPC のセリフやクエストの解禁に ch1_start / ch2_herbs / ch3_proof を書くと続く)');
          }}
          style={{ fontSize: '0.85em' }}
        >
          サンプルを入れる
        </button>
        <button type="button" onClick={() => void save()} disabled={!session.agent || !dirty || loadState !== 'ok'} style={{ marginLeft: 'auto', fontSize: '0.85em' }}>
          保存
        </button>
      </div>

      {note && <p style={{ fontSize: '0.8em', color: 'var(--color-accent)', margin: '0 0 0.4em' }}>{note}</p>}

      <div className="admin-cols">
        <div style={{ maxHeight: '72vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSel(e.id)}
              style={{
                display: 'flex', gap: '0.3em', width: '100%', padding: '0.2em 0.4em', fontSize: '0.85em', textAlign: 'left',
                border: sel === e.id ? '2px solid var(--color-accent)' : '1px solid var(--color-border)', background: 'transparent',
              }}
            >
              <span style={{ flex: 1 }}>{e.title}</span>
              <span style={{ fontSize: '0.7em', color: 'var(--color-muted)' }}>{e.when.length}条件</span>
            </button>
          ))}
          {list.length === 0 && <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>まだ無い。「＋イベント」で作る</span>}
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
                  setList((xs) => xs.filter((e) => e.id !== current.id));
                  setSel(null);
                  setDirty(true);
                }}
                style={{ marginLeft: 'auto', fontSize: '0.8em' }}
              >
                削除
              </button>
            </div>
            {field('見出し', <input value={current.title} onChange={(e) => update(current.id, { title: e.target.value })} style={{ flex: 1 }} />)}

            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>
                条件 (すべて満たすと発火。空なら最初から発火)
              </span>
              {current.when.map((c, i) => condRow(current, c, i))}
              <button
                type="button"
                onClick={() => update(current.id, { when: [...current.when, { kind: 'questDone', questId: quests[0]?.id ?? '' }] })}
                style={{ fontSize: '0.8em', marginTop: '0.2em' }}
                disabled={quests.length === 0}
              >
                ＋条件
              </button>
              {quests.length === 0 && (
                <span style={{ marginLeft: '0.4em', color: 'var(--color-muted)' }}>
                  <Link to="/admin/quests">クエスト</Link>を作ると条件に使える
                </span>
              )}
            </div>

            <div style={{ fontSize: '0.8em' }}>
              <span style={{ color: 'var(--color-muted)' }}>立てるフラグ (NPC のセリフ・クエストの解禁がこれで変わる)</span>
              {current.setFlags.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.3em', margin: '0.15em 0' }}>
                  <input
                    value={f}
                    onChange={(e) => update(current.id, { setFlags: current.setFlags.map((x, j) => (j === i ? e.target.value : x)) })}
                    style={{ width: '14em', fontFamily: 'ui-monospace, monospace' }}
                  />
                  <button
                    type="button"
                    disabled={current.setFlags.length <= 1}
                    onClick={() => update(current.id, { setFlags: current.setFlags.filter((_, j) => j !== i) })}
                    style={{ fontSize: '0.8em' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => update(current.id, { setFlags: [...current.setFlags, ''] })} style={{ fontSize: '0.8em' }}>
                ＋フラグ
              </button>
            </div>

            {field('お知らせ', (
              <input
                value={current.notice ?? ''}
                maxLength={MAX_NOTICE_LEN}
                placeholder="(なし) 例: 東の橋が なおったらしい"
                onChange={(e) => {
                  const v = e.target.value;
                  // exactOptionalPropertyTypes: 空ならキーごと消す
                  setList((xs) => xs.map((x) => {
                    if (x.id !== current.id) return x;
                    if (v.trim() === '') { const { notice: _n, ...rest } = x; return rest as ScenarioEvent; }
                    return { ...x, notice: v };
                  }));
                  setDirty(true);
                }}
                style={{ flex: 1 }}
              />
            ))}

            <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', margin: '0.3em 0 0' }}>
              使い道: <Link to="/admin/npcs">NPC</Link> のフラグ別セリフ / <Link to="/admin/quests">クエスト</Link>の解禁フラグ
            </p>
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>左の一覧から選ぶか「＋イベント」。</div>
        )}
      </div>
    </div>
  );
}
