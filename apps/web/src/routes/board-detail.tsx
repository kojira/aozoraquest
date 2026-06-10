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
import { useParams, Link } from 'react-router-dom';
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
} from '@/lib/quest-api';
import { createPost } from '@/lib/atproto';
import { getPostQuestNotifications } from '@/lib/prefs';
import { Handle } from '@/components/handle';
import { resolveHandle } from '@/lib/handle-cache';
import {
  isExpired,
  isCompleted as isCompletedFn,
  formatNotificationPost,
  type NotificationAction,
  type UserQuest,
  type QuestApplication,
  type QuestCompletion,
} from '@aozoraquest/core';

export function BoardDetail() {
  const { uri: encoded } = useParams<{ uri: string }>();
  const session = useSession();
  const uri = encoded ? decodeURIComponent(encoded) : null;
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

  const refresh = useCallback(async () => {
    if (!uri || !session.agent) return;
    try {
      const q = await getQuest(session.agent, uri);
      setQuest(q);
      if (q) {
        const [apps, comps] = await Promise.all([
          listApplicationsFor(session.agent, uri),
          listCompletionsFor(session.agent, q),
        ]);
        setApplications(apps);
        setCompletions(comps);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }, [uri, session.agent]);

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
  const completedByApproval = isCompletedFn(quest, completions ?? []);

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
    // dev 環境では default OFF。設定で明示的に ON にしている場合のみ送る。
    if (!getPostQuestNotifications()) {
      console.info('[board-detail] skip notify (postQuestNotifications=false):', action, recipientDid);
      return;
    }
    const recipientHandle = await resolveHandle(recipientDid);
    if (!recipientHandle) return;
    const text = formatNotificationPost({
      action,
      recipientHandle,
      questTitle: quest.title,
      questUrl: `${location.origin}/board/${encodeURIComponent(quest.uri)}`,
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
          <Handle did={quest.did} suffix="P" /> {quest.rewardPoints.toLocaleString()}
        </span>
        <span style={{ marginLeft: 'auto' }}>{statusLabel(quest.status, expired, completedByApproval)}</span>
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
              setDeadlineInput(quest.deadline ? toLocalInput(quest.deadline) : '');
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
              <input
                id="deadline-input"
                type="datetime-local"
                value={deadlineInput}
                onChange={(e) => setDeadlineInput(e.target.value)}
                autoFocus
                style={{ width: '100%' }}
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

      {/* assigned 中: 受託者の表示 + 受託者の完了報告フォーム */}
      {(quest.status === 'assigned' || quest.status === 'reported') && quest.assignee && (
        <section style={{ marginTop: '1.4em' }}>
          <p style={{ fontSize: '0.85em' }}>
            受託者: <strong><Handle did={quest.assignee} /></strong>
            {quest.status === 'reported' && ' (完了報告済み、承認待ち)'}
          </p>
          {isAssignee && quest.status === 'assigned' && (
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
          {isOwner && quest.status === 'reported' && (
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
      {(quest.status === 'completed' || completedByApproval) && (
        <section style={{ marginTop: '1.4em' }} className="dq-window">
          <p style={{ margin: 0, fontSize: '0.9em' }}>
            完了! 受託者 <strong>{quest.assignee ? <Handle did={quest.assignee} /> : '—'}</strong> に{' '}
            <span style={{ color: 'var(--color-accent)' }}>
              <Handle did={quest.did} suffix="P" /> {quest.rewardPoints.toLocaleString()}
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

function statusLabel(status: string, expired: boolean, completedByApproval: boolean): string {
  if (completedByApproval && status !== 'completed') return '完了 (承認済み)';
  if (status === 'completed') return '完了';
  if (expired) return '期限切れ';
  if (status === 'open') return '募集中';
  if (status === 'assigned') return '受託中';
  if (status === 'reported') return '完了報告中 (承認待ち)';
  if (status === 'cancelled') return 'キャンセル';
  return status;
}

function roleLabel(role: string): string {
  if (role === 'assigneeReport') return '完了報告';
  if (role === 'requesterApproval') return '承認';
  if (role === 'requesterRevision') return 'やり直し依頼';
  return role;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
