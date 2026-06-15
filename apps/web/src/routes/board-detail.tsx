/**
 * 依頼クエスト詳細画面 (docs/15-user-quest.md §UI 設計 C)。
 *
 * Phase 2 (応募・完了):
 *  - 応募 (自分以外の人が募集中クエストに応募メッセージ送信)
 *  - 応募者一覧 (発注者にのみ展開、「受託者に指定」ボタン付き)
 *  - 完了報告 (受託者) → 発注者承認 / やり直し依頼
 *  - completion チェーン表示
 *  - 発注者: 募集期限の延長 / キャンセル
 */
import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, Navigate, Link } from 'react-router-dom';
import { useSession } from '@/lib/session';
import {
  getQuest,
  updateQuest,
  applyToQuest,
  withdrawApplication,
  listApplicationsFor,
  setAssignee,
  reportCompletion,
  approveCompletion,
  requestRevision,
  listCompletionsFor,
  buildQuestIndexViaDiscovery,
  questUriFromParams,
  questUrlOf,
  questPath,
  type QuestIndex,
} from '@/lib/quest-api';
import { createPost } from '@/lib/atproto';
import { getPostQuestNotifications } from '@/lib/prefs';
import { refreshQuestIndex } from '@/lib/quest-index-cache';
import { useRuntimeConfig } from '@/components/config-provider';
import { Handle, RewardPoints } from '@/components/handle';
import { DateTimePicker } from '@/components/date-time-picker';
import { isoToLocalInput } from '@/lib/datetime';
import { resolveHandle } from '@/lib/handle-cache';
import {
  isExpired,
  effectiveState,
  type EffectiveState,
  formatNotificationPost,
  type NotificationAction,
  type UserQuest,
  type QuestApplication,
  type QuestCompletion,
} from '@aozoraquest/core';

export function BoardDetail() {
  // clean segment route `/board/:repo/:rkey`。collection は常に userQuest。
  const { repo, rkey } = useParams<{ repo: string; rkey: string }>();
  const session = useSession();
  const uri = repo && rkey ? questUriFromParams(repo, rkey) : null;
  const [quest, setQuest] = useState<UserQuest | null>(null);
  const [applications, setApplications] = useState<QuestApplication[] | null>(null);
  const [completions, setCompletions] = useState<QuestCompletion[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // inline form state
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [deadlineInput, setDeadlineInput] = useState('');
  const [applyForm, setApplyForm] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [reportForm, setReportForm] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [approveForm, setApproveForm] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  const [revisionForm, setRevisionForm] = useState<{ open: boolean; message: string }>({ open: false, message: '' });
  /** 受託者指定の確認: applicant did を保持 (= 確認 UI を開いている対象) */
  const [pendingAssign, setPendingAssign] = useState<string | null>(null);

  // URI 変更 (= 別 quest へ遷移) 時に inline form の state を初期化する。
  // 第三者レビューの指摘 (UI: form 持ち越し)。
  useEffect(() => {
    setEditingDeadline(false);
    setDeadlineInput('');
    setApplyForm({ open: false, message: '' });
    setReportForm({ open: false, message: '' });
    setApproveForm({ open: false, message: '' });
    setRevisionForm({ open: false, message: '' });
    setPendingAssign(null);
    setErr(null);
    setBusy(false);
  }, [uri]);

  const config = useRuntimeConfig();
  const agent = session.agent;
  const selfDid = session.did;
  // directory の DID 群 (+ 自分) から掲示板と同じ PDS 直読み index を組む材料。
  // 配列は毎 render 新規なので、effect の不要再実行を防ぐため文字列キー化する。
  const directoryDids = config.directory.map((u) => u.did);
  const aggregationKey = `${selfDid ?? ''}|${directoryDids.join(',')}`;

  const refresh = useCallback(async () => {
    // クエスト読み取りは公開 read (PDS 経由) で agent 不要。未ログインでも
    // 詳細を表示できるよう session.agent はガードしない (操作系は個別に
    // session.agent をチェック済み)。
    if (!uri) return;
    // 状態を変える操作の後に呼ばれるので、共有 index キャッシュも破棄して
    // board 一覧 (募集中カラム等) に反映されるようにする
    void refreshQuestIndex();
    try {
      // 読み取りは PDS 経由の公開 read なので agent 不要 (undefined を渡す)
      const q = await getQuest(undefined, uri);
      setQuest(q);
      if (q) {
        // 集約 Worker が未デプロイでも他ユーザーの応募が発注者に見えるよう、
        // 掲示板と同じ「discovery index (各 PDS 直読み)」を **この詳細表示用に直接** 組む。
        // (共有キャッシュ経由だと refreshQuestIndex の inflight と競合して mock を
        //  掴みうるため、詳細では毎回 fresh に組む。サインイン時のみ他 repo を読める)
        const index: QuestIndex | undefined = agent
          ? await buildQuestIndexViaDiscovery(agent, directoryDids, selfDid).catch(() => undefined)
          : undefined;
        const [apps, comps] = await Promise.all([
          listApplicationsFor(undefined, uri, index),
          listCompletionsFor(undefined, q),
        ]);
        setApplications(apps);
        setCompletions(comps);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
    // directoryDids / selfDid は aggregationKey に内包される (配列を直接 deps に
    // 入れると毎 render 別参照で refetch ループになるため文字列キーで安定化)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, agent, aggregationKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!uri) return <p>URL が壊れています。</p>;
  if (err) return <p style={{ color: 'var(--color-danger)' }}>取得に失敗: {err}</p>;
  if (!quest) return <p style={{ fontSize: '0.9em', color: 'var(--color-muted)' }}>読み込み中...</p>;

  const expired = isExpired(quest);
  const isOwner = session.did === quest.did;
  const isAssignee = session.did === quest.assignee;
  // 自分の応募の中で、取り下げてないものを最新順で先頭から (= 複数応募していても
  // 最新のアクティブ応募を「自分の応募」として扱う)。
  const myApp = applications
    ?.filter(a => a.did === session.did && !a.withdrawn)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  // 全状態・操作の gate は effectiveState を唯一の真実に (status は受託者の報告を反映しない)。
  const state = effectiveState(quest, completions ?? []);

  async function cancelQuest() {
    if (!session.agent || !quest || !isOwner) return;
    if (!confirm('このクエストをキャンセルしますか?')) return;
    setBusy(true);
    try {
      await updateQuest(session.agent, { ...quest, status: 'cancelled' });
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function extendDeadline(newDeadlineLocal: string | null) {
    if (!session.agent || !quest || !isOwner) return;
    setBusy(true);
    try {
      const next: UserQuest = { ...quest };
      if (newDeadlineLocal && newDeadlineLocal.trim()) {
        next.deadline = new Date(newDeadlineLocal).toISOString();
      } else {
        delete next.deadline;
      }
      await updateQuest(session.agent, next);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function notifyBluesky(action: NotificationAction, recipientDid: string | null) {
    if (!session.agent || !quest) return;
    if (!recipientDid) return;
    // 'applied' は集約 Worker 無しで発注者が応募者を発見する唯一の手段 (#aozoraquest 投稿で
    // discovery 網に乗せる) なので、通知設定に関わらず必ず送る。これが出ないと応募しても
    // 発注者に見えず進行が詰む。他の通知 (assigned/reported/approved/revision) は従来どおり
    // 設定に従う (dev 環境では default OFF)。
    if (action !== 'applied' && !getPostQuestNotifications()) {
      console.info('[board-detail] skip notify (postQuestNotifications=false):', action, recipientDid);
      return;
    }
    const recipientHandle = await resolveHandle(recipientDid);
    if (!recipientHandle) return;
    const text = formatNotificationPost({
      action,
      recipientHandle,
      questTitle: quest.title,
      questUrl: questUrlOf(quest.uri, location.origin),
    });
    try {
      await createPost(session.agent, text);
    } catch (e) {
      console.warn('[board-detail] notify post failed', e);
    }
  }

  async function submitApply() {
    if (!session.agent || !session.did || !quest) return;
    const message = applyForm.message.trim();
    if (!message) return;
    setBusy(true);
    try {
      await applyToQuest(session.agent, session.did, quest.uri, message);
      await notifyBluesky('applied', quest.did);
      setApplyForm({ open: false, message: '' });
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (!session.agent || !myApp) return;
    if (!confirm('応募を取り下げますか?')) return;
    setBusy(true);
    try {
      await withdrawApplication(session.agent, myApp);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssign(applicantDid: string) {
    if (!session.agent || !quest || !isOwner) return;
    setBusy(true);
    try {
      await setAssignee(session.agent, quest, applicantDid);
      await notifyBluesky('assigned', applicantDid);
      setPendingAssign(null);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    if (!session.agent || !session.did || !quest || !isAssignee) return;
    setBusy(true);
    try {
      const comment = reportForm.message.trim();
      await reportCompletion(session.agent, session.did, quest, comment || undefined);
      await notifyBluesky('reported', quest.did);
      setReportForm({ open: false, message: '' });
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function submitApprove() {
    if (!session.agent || !session.did || !quest || !isOwner) return;
    setBusy(true);
    try {
      const comment = approveForm.message.trim();
      await approveCompletion(session.agent, session.did, quest, comment || undefined);
      if (quest.assignee) await notifyBluesky('approved', quest.assignee);
      setApproveForm({ open: false, message: '' });
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function submitRevision() {
    if (!session.agent || !session.did || !quest || !isOwner) return;
    const comment = revisionForm.message.trim();
    if (!comment) return;
    setBusy(true);
    try {
      await requestRevision(session.agent, session.did, quest, comment);
      if (quest.assignee) await notifyBluesky('revisionRequested', quest.assignee);
      setRevisionForm({ open: false, message: '' });
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '0.6em' }}>
        <Link to="/board" style={{ fontSize: '0.85em' }}>← 一覧へ戻る</Link>
      </div>

      <h2 style={{ marginTop: 0, fontSize: '1.15em' }}>{quest.title}</h2>

      <div style={{ display: 'flex', gap: '0.6em', flexWrap: 'wrap', fontSize: '0.85em', color: 'var(--color-muted)' }}>
        <span>発注者: <Handle did={quest.did} /></span>
        <span style={{ color: 'var(--color-accent)' }}>
          <RewardPoints did={quest.did} points={quest.rewardPoints} />
        </span>
        <span style={{ marginLeft: 'auto' }}>{statusLabel(state)}</span>
      </div>

      <div style={{ marginTop: '0.6em', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{quest.body}</div>

      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginTop: '0.8em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {quest.tags.map(t => <span key={t}>#{t}</span>)}
      </div>

      {quest.deadline && (
        <p style={{ marginTop: '0.6em', fontSize: '0.85em' }}>
          募集期限: {new Date(quest.deadline).toLocaleString()} {expired && <span style={{ color: 'var(--color-danger)' }}>(期限切れ)</span>}
        </p>
      )}

      {/* 発注者向け: 期限変更 / キャンセル (open 中のみ) */}
      {isOwner && quest.status === 'open' && (
        <div style={{ marginTop: '1em' }}>
          <div style={{ display: 'flex', gap: '0.6em' }}>
            <button onClick={() => {
              setDeadlineInput(quest.deadline ? isoToLocalInput(quest.deadline) : '');
              setEditingDeadline(true);
            }} disabled={busy}>募集期限を変更</button>
            <button onClick={cancelQuest} disabled={busy}>キャンセル</button>
          </div>
          {editingDeadline && (
            <div className="dq-window compact" style={{ marginTop: '0.5em' }}>
              <h4 style={{ margin: '0 0 0.4em', fontSize: '0.9em' }}>募集期限を変更</h4>
              <label htmlFor="deadline-input" style={{ display: 'block', fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>
                新しい期限 (空欄で削除)
              </label>
              <DateTimePicker
                id="deadline-input"
                value={deadlineInput}
                onChange={setDeadlineInput}
                ariaLabel="新しい募集期限を選択"
              />
              <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                <button onClick={async () => { await extendDeadline(deadlineInput); setEditingDeadline(false); }} disabled={busy}>適用</button>
                <button className="secondary" onClick={() => setEditingDeadline(false)} disabled={busy}>キャンセル</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 応募者向け: 応募フォーム / 自分の応募表示 */}
      {!isOwner && session.status === 'signed-in' && quest.status === 'open' && !expired && (
        <div style={{ marginTop: '1em' }}>
          {!myApp ? (
            !applyForm.open ? (
              <button onClick={() => setApplyForm({ open: true, message: '' })} disabled={busy}>このクエストに応募する</button>
            ) : (
              <div className="dq-window compact">
                <h4 style={{ margin: '0 0 0.4em', fontSize: '0.9em' }}>クエストに応募する</h4>
                <label htmlFor="apply-msg" style={{ display: 'block', fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>応募メッセージ (やる気・経験・質問など)</label>
                <textarea
                  id="apply-msg"
                  value={applyForm.message}
                  onChange={(e) => setApplyForm({ ...applyForm, message: e.target.value })}
                  rows={4}
                  autoFocus
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                  <button onClick={submitApply} disabled={busy || !applyForm.message.trim()}>応募する</button>
                  <button className="secondary" onClick={() => setApplyForm({ open: false, message: '' })} disabled={busy}>キャンセル</button>
                </div>
              </div>
            )
          ) : (
            <div className="dq-window compact">
              <p style={{ margin: 0, fontSize: '0.85em' }}>あなたの応募:</p>
              <p style={{ margin: '0.3em 0', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{myApp.message}</p>
              <button onClick={onWithdraw} disabled={busy} className="secondary">取り下げる</button>
            </div>
          )}
        </div>
      )}

      {/* 発注者向け応募者一覧 (open のとき): withdrawn は除外 */}
      {isOwner && quest.status === 'open' && (() => {
        const activeApps = applications?.filter(a => !a.withdrawn) ?? null;
        return (
          <section style={{ marginTop: '1.4em' }}>
            <h3 style={{ fontSize: '0.95em' }}>応募者 ({activeApps?.length ?? 0})</h3>
            {!activeApps && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中...</p>}
            {activeApps && activeApps.length === 0 && (
              <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>まだ応募がありません。</p>
            )}
            {activeApps && activeApps.map(a => (
              <div key={a.uri} className="dq-window compact">
                <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
                  <Handle did={a.did} /> - {new Date(a.createdAt).toLocaleString()}
                </p>
                <p style={{ margin: '0.3em 0', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{a.message}</p>
                {pendingAssign === a.did ? (
                  <div style={{ marginTop: '0.4em', padding: '0.4em', background: 'rgba(255,255,255,0.06)', borderRadius: '2px' }}>
                    <p style={{ margin: '0 0 0.4em', fontSize: '0.85em' }}>
                      <strong><Handle did={a.did} /></strong> を受託者に指定しますか?<br />
                      <span style={{ fontSize: '0.78em', color: 'var(--color-muted)' }}>
                        他の応募者には自動通知は送られませんが、ステータスが「受託中」に変わり追加応募は受け付けられなくなります。
                      </span>
                    </p>
                    <div style={{ display: 'flex', gap: '0.5em' }}>
                      <button onClick={() => confirmAssign(a.did)} disabled={busy}>確定する</button>
                      <button className="secondary" onClick={() => setPendingAssign(null)} disabled={busy}>戻る</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setPendingAssign(a.did)} disabled={busy || pendingAssign !== null}>受託者に指定</button>
                )}
              </div>
            ))}
          </section>
        );
      })()}

      {/* 受託確定〜完了前: 受託者の表示 + 受託者の完了報告フォーム (state は completion 由来) */}
      {(state === 'IN_PROGRESS' || state === 'AWAITING_APPROVAL' || state === 'REVISION_REQUESTED') && quest.assignee && (
        <section style={{ marginTop: '1.4em' }}>
          <p style={{ fontSize: '0.85em' }}>
            受託者: <strong><Handle did={quest.assignee} /></strong>
            {state === 'AWAITING_APPROVAL' && ' (完了報告済み、承認待ち)'}
            {state === 'REVISION_REQUESTED' && ' (やり直し依頼中)'}
          </p>
          {/* 受託者は作業中(未報告) と 差し戻し中 のとき報告できる。報告後(承認待ち)は隠す。
              completions ロード中 (null) は state が IN_PROGRESS に見えるため、確定するまで
              報告ボタンを出さない (ちらつき + 報告済みなのに再報告で二重 report を防ぐ)。 */}
          {isAssignee && completions !== null && (state === 'IN_PROGRESS' || state === 'REVISION_REQUESTED') && (
            !reportForm.open ? (
              <button onClick={() => setReportForm({ open: true, message: '' })} disabled={busy}>完了を報告する</button>
            ) : (
              <div className="dq-window compact">
                <h4 style={{ margin: '0 0 0.4em', fontSize: '0.9em' }}>完了を報告する</h4>
                <label htmlFor="report-msg" style={{ display: 'block', fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>成果物の URL・一言コメント (任意)</label>
                <textarea
                  id="report-msg"
                  value={reportForm.message}
                  onChange={(e) => setReportForm({ ...reportForm, message: e.target.value })}
                  rows={4}
                  autoFocus
                  placeholder="例: https://example.com/illust.png&#10;こんな感じになりました!"
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                  <button onClick={submitReport} disabled={busy}>完了を報告する</button>
                  <button className="secondary" onClick={() => setReportForm({ open: false, message: '' })} disabled={busy}>キャンセル</button>
                </div>
              </div>
            )
          )}
          {isOwner && state === 'AWAITING_APPROVAL' && (
            <div style={{ marginTop: '0.4em' }}>
              {!approveForm.open && !revisionForm.open && (
                <div style={{ display: 'flex', gap: '0.6em' }}>
                  <button onClick={() => setApproveForm({ open: true, message: '' })} disabled={busy}>承認する (報酬を発行)</button>
                  <button onClick={() => setRevisionForm({ open: true, message: '' })} disabled={busy} className="secondary">やり直しを依頼</button>
                </div>
              )}
              {approveForm.open && (
                <div className="dq-window compact">
                  <h4 style={{ margin: '0 0 0.4em', fontSize: '0.9em' }}>完了を承認する (報酬を発行)</h4>
                  <label htmlFor="approve-msg" style={{ display: 'block', fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>承認コメント (任意)</label>
                  <textarea
                    id="approve-msg"
                    value={approveForm.message}
                    onChange={(e) => setApproveForm({ ...approveForm, message: e.target.value })}
                    rows={3}
                    autoFocus
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                    <button onClick={submitApprove} disabled={busy}>承認する</button>
                    <button className="secondary" onClick={() => setApproveForm({ open: false, message: '' })} disabled={busy}>戻る</button>
                  </div>
                </div>
              )}
              {revisionForm.open && (
                <div className="dq-window compact">
                  <h4 style={{ margin: '0 0 0.4em', fontSize: '0.9em' }}>やり直しを依頼する</h4>
                  <label htmlFor="revision-msg" style={{ display: 'block', fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>依頼する理由 (必須)</label>
                  <textarea
                    id="revision-msg"
                    value={revisionForm.message}
                    onChange={(e) => setRevisionForm({ ...revisionForm, message: e.target.value })}
                    rows={4}
                    autoFocus
                    style={{ width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: '0.5em', marginTop: '0.5em' }}>
                    <button onClick={submitRevision} disabled={busy || !revisionForm.message.trim()}>送信する</button>
                    <button className="secondary" onClick={() => setRevisionForm({ open: false, message: '' })} disabled={busy}>戻る</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 完了済み: 報酬表示 */}
      {state === 'COMPLETED' && (
        <section style={{ marginTop: '1.4em' }} className="dq-window">
          <p style={{ margin: 0, fontSize: '0.9em' }}>
            完了! 受託者 <strong>{quest.assignee ? <Handle did={quest.assignee} /> : '—'}</strong> に{' '}
            <span style={{ color: 'var(--color-accent)' }}>
              <RewardPoints did={quest.did} points={quest.rewardPoints} />
            </span>{' '}
            が発行されました。
          </p>
        </section>
      )}

      {/* completion チェーン */}
      {completions && completions.length > 0 && (
        <section style={{ marginTop: '1.4em' }}>
          <h3 style={{ fontSize: '0.95em' }}>進行記録</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {completions.map(c => (
              <li key={c.uri} className="dq-window compact">
                <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
                  {roleLabel(c.role)} - <Handle did={c.did} /> - {new Date(c.createdAt).toLocaleString()}
                </p>
                {c.comment && <p style={{ margin: '0.3em 0', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{c.comment}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function statusLabel(state: EffectiveState): string {
  switch (state) {
    case 'COMPLETED':          return '完了';
    case 'EXPIRED':            return '期限切れ';
    case 'OPEN':               return '募集中';
    case 'IN_PROGRESS':        return '受託中';
    case 'AWAITING_APPROVAL':  return '完了報告中 (承認待ち)';
    case 'REVISION_REQUESTED': return 'やり直し対応中';
    case 'CANCELLED':          return 'キャンセル';
  }
}

function roleLabel(role: string): string {
  if (role === 'assigneeReport') return '完了報告';
  if (role === 'requesterApproval') return '承認';
  if (role === 'requesterRevision') return 'やり直し依頼';
  return role;
}

/**
 * 旧 `/board/<encodeURIComponent(at-uri)>` リンク (Bluesky に投稿済み) の救済。
 * 新規ロードで `%2F` が `/` に正規化され、splat route の pathname に at-uri が
 * そのまま入るので、それを clean form (`/board/:repo/:rkey`) へ redirect する。
 * at-uri として解釈できなければ掲示板トップへ。
 */
export function BoardDetailLegacyRedirect() {
  const location = useLocation();
  let target = '/board';
  try {
    const rest = decodeURIComponent(location.pathname.replace(/^\/board\//, ''));
    target = questPath(rest); // parseAtUri が throw すれば catch
  } catch {
    target = '/board';
  }
  return <Navigate to={target} replace />;
}
