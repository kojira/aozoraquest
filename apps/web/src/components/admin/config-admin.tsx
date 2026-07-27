import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { ADMIN_COL } from '@/lib/collections';
import { useAdminConfig } from '@/lib/use-admin-config';

/**
 * **主管理者 PDS の設定レコードを編集する画面群** (docs/14-admin)。
 *
 * 元は独立した admin アプリ (`apps/admin`) にあったが、**デプロイ設定が無く
 * `pnpm dev` でしか開けなかった**。ローカルでなくても開けるように、そして見た目を
 * 今のフロントに揃えるために `/admin` に取り込んだ。
 *
 * 書き込み仕様 (`$type` を付ける / 既存を保持して追加) は
 * `scripts/refresh-directory.ts` (毎時の GitHub Actions) と揃えること —
 * ずれると cron と画面が互いの結果を踏み合う。
 */

/**
 * 共通の保存バー。5 画面で同じものを書かない。
 *
 * **読めるまで保存させない。** ここを開けておくと、読み込み前 (または読み込みに失敗した
 * 状態) で押されたときに、画面の state = 空のまま保存されて
 * **BAN リスト / ディレクトリ / フラグが全消しになる**。旧 admin アプリから引き継いだ穴で、
 * あちらはローカルでしか開けなかったが、本番の画面に置く以上は塞ぐ。
 *
 * **`loaded` だけでは足りない** — あれは「読み終えた (失敗含む)」なので、通信が落ちても
 * true になる。レコードが無い (value=null) のは正常、読めなかったのは異常、と分けて扱う。
 */
function SaveBar({ loaded, loadFailed, saving, savedMark, err, canWrite, onSave, label = '保存する' }: {
  loaded: boolean; loadFailed: boolean; saving: boolean; savedMark: boolean; err: string | null; canWrite: boolean; onSave: () => void; label?: string;
}) {
  const ready = loaded && !loadFailed && canWrite && !saving;
  return (
    <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', marginTop: '0.5em', flexWrap: 'wrap' }}>
      <button onClick={onSave} disabled={!ready}>{saving ? '保存中…' : label}</button>
      {!loaded && <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込むまで保存できない</span>}
      {loadFailed && <span style={{ fontSize: '0.85em', color: 'var(--color-danger, #e8566a)' }}>読み込めていないので保存できない (上書きで全消しになるため)</span>}
      {savedMark && <span style={{ fontSize: '0.85em', color: 'var(--color-accent)' }}>✓ 保存した</span>}
      {err && <span style={{ fontSize: '0.85em', color: 'var(--color-danger, #e8566a)' }}>{err}</span>}
    </div>
  );
}

/** **保存しても効かない**画面の印。判定関数はあるが production の呼び出し元が無い (#561)。
 *  「メンテを開始した」と信じて破壊的作業に入られるのが一番まずいので、見出しに出す。 */
function NotWired() {
  return (
    <span style={{ fontSize: '0.75em', color: 'var(--color-danger, #e8566a)', marginLeft: '0.4em', fontWeight: 400 }}>
      未配線 (保存しても効かない)
    </span>
  );
}

/** 主管理者以外でログインしているときの注意。保存しても web が読む先に反映されない。 */
function WriteGuard({ canWrite }: { canWrite: boolean }) {
  if (canWrite) return null;
  return (
    <p style={{ fontSize: '0.8em', color: 'var(--color-danger, #e8566a)', margin: '0.2em 0' }}>
      主管理者のアカウントでないため保存できない (書き込み先が主管理者の repo のため)。閲覧のみ。
    </p>
  );
}

// ─────────────────────────────────────────── 参加者ディレクトリ

interface Entry { did: string; addedAt: string; note?: string }
interface DirectoryRecord { users: Entry[]; updatedAt: string }

/** オプトインの目印。`scripts/refresh-directory.ts` の `OPTIN_TAG` と同じ。 */
const OPTIN_TAG = 'aozoraquest';
/** 検索の走査ページ数。同スクリプトの `MAX_PAGES` と同じ。 */
const MAX_PAGES = 5;

export function DirectoryAdmin({ agent }: { agent: Agent }) {
  const { loaded, loadFailed, value, save, reload, saving, err, savedMark, canWrite } = useAdminConfig<DirectoryRecord>(ADMIN_COL.directory, 'self');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [didInput, setDidInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => { if (value?.users) setEntries(value.users); }, [value]);

  const add = () => {
    const d = didInput.trim();
    if (!d.startsWith('did:') || entries.some((e) => e.did === d)) return;
    const note = noteInput.trim();
    setEntries([...entries, { did: d, addedAt: new Date().toISOString(), ...(note ? { note } : {}) }]);
    setDidInput('');
    setNoteInput('');
  };

  /** `#aozoraquest` 投稿を走査して**追加だけ**する。削除はこの画面でしかできない
   *  (毎時の cron は追加しかしないので、消したものを復活させない設計)。 */
  const refreshFromSearch = async () => {
    setBusy(true);
    setSummary(null);
    try {
      const seen = new Set(entries.map((e) => e.did));
      const next = [...entries];
      let cursor: string | undefined;
      let posts = 0;
      let added = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await agent.app.bsky.feed.searchPosts({ q: `#${OPTIN_TAG}`, limit: 100, ...(cursor !== undefined ? { cursor } : {}) });
        posts += res.data.posts.length;
        for (const post of res.data.posts) {
          const d = post.author?.did;
          if (!d || seen.has(d)) continue;
          seen.add(d);
          next.push({ did: d, addedAt: new Date().toISOString(), note: 'auto' });
          added++;
        }
        const c = res.data.cursor;
        if (!c || c === cursor) break;
        cursor = c;
      }
      setEntries(next);
      setSummary(`投稿 ${posts} 件を走査、新規 ${added} 人。合計 ${next.length} 人 (まだ保存していない)`);
    } catch (e) {
      setSummary(`検索に失敗した: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * 保存。**直前に読み直して、画面を開いてから cron が足したぶんを取りこぼさない。**
   * `putRecord` は無条件上書き (CAS 無し) なので、10:05 に開いて 11:10 に保存すると
   * 11:00 の cron が足した人が消える。この画面で明示的に「外した」人だけを引く。
   */
  const saveMerged = async () => {
    const removed = new Set((value?.users ?? []).filter((o) => !entries.some((e) => e.did === o.did)).map((o) => o.did));
    let latest: Entry[] = entries;
    try {
      const fresh = await reload();
      if (fresh) {
        const byDid = new Map(entries.map((e) => [e.did, e]));
        for (const u of fresh.users ?? []) if (!byDid.has(u.did) && !removed.has(u.did)) byDid.set(u.did, u);
        latest = [...byDid.values()].filter((u) => !removed.has(u.did));
      }
    } catch {
      // 読み直せなければ手元のまま保存する (保存自体を諦めるほうが体験が悪い)
    }
    setEntries(latest);
    await save({ users: latest, updatedAt: new Date().toISOString() } satisfies DirectoryRecord);
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>参加者ディレクトリ ({entries.length} 人)</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        共鳴タイムラインと依頼クエストの発見元。<code>#{OPTIN_TAG}</code> 付きの投稿でオプトインする。
        毎時の自動更新は<strong>追加だけ</strong>なので、<strong>削除はここでしかできない</strong>。
      </p>
      <WriteGuard canWrite={canWrite} />
      {!loaded && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>}

      <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', marginTop: '0.5em' }}>
        <button onClick={() => void refreshFromSearch()} disabled={busy}>
          {busy ? '検索中…' : `検索から更新 (#${OPTIN_TAG} を走査)`}
        </button>
      </div>
      {summary && <p style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginTop: '0.3em' }}>{summary}</p>}

      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginTop: '0.5em' }}>
        <input value={didInput} onChange={(e) => setDidInput(e.target.value)} placeholder="did:plc:..." style={{ flex: '1 1 16em', minWidth: 0 }} />
        <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)} placeholder="メモ (任意)" style={{ flex: '0 1 8em', minWidth: 0 }} />
        <button onClick={add}>手動で追加</button>
      </div>

      {entries.length > 0 && (
        <div className="dq-window" style={{ padding: '0.5em 0.7em', marginTop: '0.5em', maxHeight: '16em', overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.8em' }}>
            {entries.map((e) => (
              <li key={e.did} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.15em 0' }}>
                <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.did}</code>
                {e.note && <span style={{ color: 'var(--color-muted)' }}>{e.note}</span>}
                <button onClick={() => setEntries(entries.filter((x) => x.did !== e.did))} style={{ fontSize: '0.9em' }}>外す</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SaveBar loaded={loaded} loadFailed={loadFailed} saving={saving} savedMark={savedMark} err={err} canWrite={canWrite}
        onSave={() => void saveMerged()} />
    </section>
  );
}

// ─────────────────────────────────────────── 精霊プロンプト

interface PromptRecord { id: 'spiritChat'; body: string; maxNewTokens?: number; updatedAt: string }
/** lexicon の制約 (200) と一致させること。web は soft cap として解釈する。 */
const MAX_NEW_TOKENS_UPPER = 200;

export function PromptsAdmin() {
  const { loaded, loadFailed, value, save, saving, err, savedMark, canWrite } = useAdminConfig<PromptRecord>(ADMIN_COL.configPrompts, 'spiritChat');
  const [body, setBody] = useState('');
  const [tokens, setTokens] = useState('');

  useEffect(() => {
    setBody(value?.body ?? '');
    setTokens(value?.maxNewTokens !== undefined ? String(value.maxNewTokens) : '');
  }, [value]);

  const parsed: number | 'unset' | 'invalid' = (() => {
    const t = tokens.trim();
    if (t === '') return 'unset';
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1 || n > MAX_NEW_TOKENS_UPPER) return 'invalid';
    return n;
  })();
  const tokenErr = parsed === 'invalid' ? `1〜${MAX_NEW_TOKENS_UPPER} の整数で (空欄なら未設定)` : null;

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>精霊プロンプト</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        精霊の性格・口調。空欄にすると web 側の既定文が使われる。
      </p>
      <WriteGuard canWrite={canWrite} />
      {!loaded && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>}

      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8}
        style={{ width: '100%', marginTop: '0.4em', fontSize: '0.85em' }} placeholder="あなたは…" />

      <div style={{ display: 'flex', gap: '0.5em', alignItems: 'center', marginTop: '0.4em', fontSize: '0.85em' }}>
        <label htmlFor="maxNewTokens">生成トークン上限</label>
        <input id="maxNewTokens" value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder="未設定" style={{ width: '6em' }} />
        {tokenErr && <span style={{ color: 'var(--color-danger, #e8566a)' }}>{tokenErr}</span>}
      </div>

      <SaveBar loaded={loaded} loadFailed={loadFailed} saving={saving} savedMark={savedMark} err={err} canWrite={canWrite && !tokenErr}
        onSave={() => {
          if (tokenErr) return;
          void save({ id: 'spiritChat', body, ...(typeof parsed === 'number' ? { maxNewTokens: parsed } : {}), updatedAt: new Date().toISOString() } satisfies PromptRecord);
        }} />
    </section>
  );
}

// ─────────────────────────────────────────── メンテナンス

interface MaintRecord { enabled: boolean; message?: string; until?: string; allowedDids?: string[]; updatedAt: string }

export function MaintenanceAdmin() {
  const { loaded, loadFailed, value, save, saving, err, savedMark, canWrite } = useAdminConfig<MaintRecord>(ADMIN_COL.configMaintenance, 'self');
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('メンテナンス中です。しばらくお待ちください。');
  const [until, setUntil] = useState('');
  const [confirm, setConfirm] = useState('');

  useEffect(() => {
    if (!value) return;
    setEnabled(value.enabled ?? false);
    if (value.message !== undefined) setMessage(value.message);
    if (value.until !== undefined) setUntil(value.until);
  }, [value]);

  // **有効化は全ユーザーを止める**ので、合言葉を打たせる (誤操作の抑止)。解除は自由。
  const armed = !enabled || confirm === 'MAINTENANCE';

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>メンテナンスモード <NotWired /></h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        「メンテ中」の印を残すだけで、<strong>いまは誰も止まらない</strong>。
        `isUnderMaintenance` を実際に見ている画面がまだ無い (#561)。
        <br />
        配線するときは注意: 現在の判定は <code>allowedDids</code> しか通さないので、
        そのまま繋ぐと<strong>主管理者自身も締め出されて解除できなくなる</strong>。
      </p>
      <WriteGuard canWrite={canWrite} />
      {!loaded && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>}

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4em', fontSize: '0.9em', marginTop: '0.4em' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        メンテナンス中にする
      </label>
      <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="表示するメッセージ"
        style={{ width: '100%', marginTop: '0.4em', fontSize: '0.85em' }} />
      <input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="終了予定 (任意。例 2026-07-28T10:00)"
        style={{ width: '100%', marginTop: '0.4em', fontSize: '0.85em' }} />
      {enabled && (
        <div style={{ marginTop: '0.4em' }}>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="確認のため MAINTENANCE と入力"
            style={{ width: '100%', fontSize: '0.85em' }} />
        </div>
      )}

      <SaveBar loaded={loaded} loadFailed={loadFailed} saving={saving} savedMark={savedMark} err={err} canWrite={canWrite && armed}
        label={enabled ? 'メンテナンスを開始' : '保存する'}
        onSave={() => void save({
          enabled,
          ...(message ? { message } : {}),
          ...(until ? { until } : {}),
          // **この画面で編集しない項目を落とさない。** allowedDids (メンテ中でも通す DID) を
          // 省くと、保存のたびに既存の設定が消える。
          ...(value?.allowedDids ? { allowedDids: value.allowedDids } : {}),
          updatedAt: new Date().toISOString(),
        } satisfies MaintRecord)} />
    </section>
  );
}

// ─────────────────────────────────────────── BAN リスト

interface BansRecord { dids: string[]; updatedAt: string }

export function BansAdmin() {
  const { loaded, loadFailed, value, save, saving, err, savedMark, canWrite } = useAdminConfig<BansRecord>(ADMIN_COL.configBans, 'self');
  const [dids, setDids] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => { if (value?.dids) setDids(value.dids); }, [value]);

  const add = () => {
    const d = input.trim();
    if (!d.startsWith('did:') || dids.includes(d)) return;
    setDids([...dids, d]);
    setInput('');
  };

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>BAN リスト ({dids.length}) <NotWired /></h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        名簿を残すだけで、<strong>いまは何も除外されない</strong>。
        `isBanned` を実際に見ている画面がまだ無い (#561)。
        <br />
        <strong>このレコードは公開される</strong> (主管理者 PDS の公開レコード) ことに注意。
      </p>
      <WriteGuard canWrite={canWrite} />
      {!loaded && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>}

      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.4em' }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="did:plc:..." style={{ flex: 1, minWidth: 0 }} />
        <button onClick={add}>追加</button>
      </div>

      {dids.length > 0 && (
        <div className="dq-window" style={{ padding: '0.5em 0.7em', marginTop: '0.5em', maxHeight: '12em', overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.8em' }}>
            {dids.map((d) => (
              <li key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.15em 0' }}>
                <code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</code>
                <button onClick={() => setDids(dids.filter((x) => x !== d))} style={{ fontSize: '0.9em' }}>外す</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SaveBar loaded={loaded} loadFailed={loadFailed} saving={saving} savedMark={savedMark} err={err} canWrite={canWrite}
        onSave={() => void save({ dids, updatedAt: new Date().toISOString() } satisfies BansRecord)} />
    </section>
  );
}

// ─────────────────────────────────────────── フィーチャーフラグ

interface FlagDraft { id: string; enabled: boolean; rollout: number; description: string }
interface FlagsRecord { flags: Record<string, { enabled: boolean; rollout: number; description: string }>; updatedAt: string }

/** レコードが空のときの初期値 (旧 admin アプリと同じ)。 */
const INITIAL_FLAGS: FlagDraft[] = [
  { id: 'compatibilityMap', enabled: true, rollout: 100, description: '共鳴マップ' },
  { id: 'pairTitles', enabled: false, rollout: 0, description: 'ペア称号' },
];

export function FlagsAdmin() {
  const { loaded, loadFailed, value, save, saving, err, savedMark, canWrite } = useAdminConfig<FlagsRecord>(ADMIN_COL.configFlags, 'self');
  const [flags, setFlags] = useState<FlagDraft[]>(INITIAL_FLAGS);
  const [newId, setNewId] = useState('');

  useEffect(() => {
    // **レコードがあるなら中身が空でもそのまま反映する。** 空を INITIAL_FLAGS にすり替えると、
    // 全部外して保存した後に開き直したとき「compatibilityMap 有効 100%」と表示され、
    // その状態で別のフラグを足して保存すると**実際に全ユーザーへ開いてしまう**。
    if (value === null) return; // 未作成のときだけ初期値のまま
    setFlags(Object.entries(value.flags ?? {}).map(([id, v]) => ({ id, enabled: v.enabled, rollout: v.rollout, description: v.description })));
  }, [value]);

  const patch = (id: string, p: Partial<FlagDraft>) => setFlags((fs) => fs.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <section style={{ marginTop: '2em' }}>
      <h3 style={{ fontSize: '0.95em' }}>フィーチャーフラグ</h3>
      <p style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>
        機能の出し分け。rollout は DID のハッシュで決まる割合 (0〜100)。
      </p>
      <WriteGuard canWrite={canWrite} />
      {!loaded && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中…</p>}

      <div className="dq-window" style={{ padding: '0.5em 0.7em', marginTop: '0.4em' }}>
        {flags.map((f) => (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5em', padding: '0.25em 0', flexWrap: 'wrap', fontSize: '0.85em' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.3em', flex: '1 1 12em', minWidth: 0 }}>
              <input type="checkbox" checked={f.enabled} onChange={(e) => patch(f.id, { enabled: e.target.checked })} />
              <code style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.id}</code>
            </label>
            <input value={f.rollout} onChange={(e) => patch(f.id, { rollout: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              style={{ width: '4em' }} aria-label={`${f.id} の rollout`} />
            <span style={{ color: 'var(--color-muted)' }}>%</span>
            <input value={f.description} onChange={(e) => patch(f.id, { description: e.target.value })}
              placeholder="説明" style={{ flex: '1 1 10em', minWidth: 0 }} aria-label={`${f.id} の説明`} />
            <button onClick={() => setFlags(flags.filter((x) => x.id !== f.id))} style={{ fontSize: '0.9em' }}>外す</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.4em', marginTop: '0.4em' }}>
        <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="新しいフラグ id" style={{ flex: 1, minWidth: 0 }} />
        <button onClick={() => {
          const id = newId.trim();
          if (!id || flags.some((f) => f.id === id)) return;
          setFlags([...flags, { id, enabled: false, rollout: 0, description: '' }]);
          setNewId('');
        }}>追加</button>
      </div>

      <SaveBar loaded={loaded} loadFailed={loadFailed} saving={saving} savedMark={savedMark} err={err} canWrite={canWrite}
        onSave={() => void save({
          flags: Object.fromEntries(flags.map((f) => [f.id, { enabled: f.enabled, rollout: f.rollout, description: f.description }])),
          updatedAt: new Date().toISOString(),
        } satisfies FlagsRecord)} />
    </section>
  );
}
