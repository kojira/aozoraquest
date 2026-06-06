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
  parseAtUri,
  applyToQuest,
  withdrawApplication,
  listApplicationsFor,
  setAssignee,
  reportCompletion,
  approveCompletion,
  requestRevision,
  listCompletionsFor,
} from '@/lib/quest-api';
import { mockIndex } from '@/lib/quest-mock';
import { putRecord, createPost } from '@/lib/atproto';
import { COL } from '@/lib/collections';
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
  const myApp = applications?.find(a => a.did === session.did) ?? null;
  const completedByApproval = isCompletedFn(quest, completions ?? []);

  async function cancelQuest() {
    if (!session.agent || !quest || !isOwner) return;
    if (!confirm('このクエストをキャンセルしますか?')) return;
    setBusy(true);
    try {
      const { rkey } = parseAtUri(quest.uri);
      const next = { ...quest, status: 'cancelled' as const, updatedAt: new Date().toISOString() };
      const record: Record<string, unknown> = { ...next, $type: COL.userQuest };
      delete record.uri;
      delete record.did;
      await putRecord(session.agent, COL.userQuest, rkey, record);
      mockIndex.updateQuestStatus(quest.uri, 'cancelled');
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function extendDeadline() {
    if (!session.agent || !quest || !isOwner) return;
    const cur = quest.deadline ? toLocalInput(quest.deadline) : '';
    const next = prompt('新しい募集期限 (YYYY-MM-DDTHH:MM、空欄で削除)', cur);
    if (next === null) return;
    setBusy(true);
    try {
      const { rkey } = parseAtUri(quest.uri);
      const deadlineIso = next.trim() ? new Date(next).toISOString() : undefined;
      const updated: UserQuest = { ...quest, updatedAt: new Date().toISOString() };
      if (deadlineIso) updated.deadline = deadlineIso;
      else delete updated.deadline;
      const record: Record<string, unknown> = { ...updated, $type: COL.userQuest };
      delete record.uri;
      delete record.did;
      await putRecord(session.agent, COL.userQuest, rkey, record);
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

  async function onApply() {
    if (!session.agent || !session.did || !quest) return;
    const message = prompt('応募メッセージ (やる気・経験・質問など):');
    if (!message?.trim()) return;
    setBusy(true);
    try {
      await applyToQuest(session.agent, session.did, quest.uri, message.trim());
      // 発注者宛の通知 (handle は今は did stub にフォールバック。Phase 3 後半で
      // AppView から正規 handle 解決するキャッシュ層を入れる)
      await notifyBluesky('applied', quest.did);
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

  async function onAssign(applicantDid: string) {
    if (!session.agent || !quest || !isOwner) return;
    if (!confirm('この応募者を受託者に指定しますか? 他の応募は受け付けられなくなります。')) return;
    setBusy(true);
    try {
      await setAssignee(session.agent, quest, applicantDid);
      await notifyBluesky('assigned', applicantDid);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onReport() {
    if (!session.agent || !session.did || !quest || !isAssignee) return;
    const comment = prompt('完了報告 (成果物の URL や一言コメント):');
    if (comment === null) return;
    setBusy(true);
    try {
      await reportCompletion(session.agent, session.did, quest, comment.trim() || undefined);
      await notifyBluesky('reported', quest.did);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onApprove() {
    if (!session.agent || !session.did || !quest || !isOwner) return;
    const comment = prompt('承認コメント (任意):');
    if (comment === null) return;
    setBusy(true);
    try {
      await approveCompletion(session.agent, session.did, quest, comment.trim() || undefined);
      if (quest.assignee) await notifyBluesky('approved', quest.assignee);
      await refresh();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onRevision() {
    if (!session.agent || !session.did || !quest || !isOwner) return;
    const comment = prompt('やり直し依頼コメント (必須):');
    if (!comment?.trim()) return;
    setBusy(true);
    try {
      await requestRevision(session.agent, session.did, quest, comment.trim());
      if (quest.assignee) await notifyBluesky('revisionRequested', quest.assignee);
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
        <div style={{ display: 'flex', gap: '0.6em', marginTop: '1em' }}>
          <button onClick={extendDeadline} disabled={busy}>募集期限を変更</button>
          <button onClick={cancelQuest} disabled={busy}>キャンセル</button>
        </div>
      )}

      {/* 応募者向け: 応募ボタン / 自分の応募表示 */}
      {!isOwner && session.status === 'signed-in' && quest.status === 'open' && !expired && (
        <div style={{ marginTop: '1em' }}>
          {!myApp ? (
            <button onClick={onApply} disabled={busy}>このクエストに応募する</button>
          ) : (
            <div className="dq-window compact">
              <p style={{ margin: 0, fontSize: '0.85em' }}>あなたの応募:</p>
              <p style={{ margin: '0.3em 0', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{myApp.message}</p>
              <button onClick={onWithdraw} disabled={busy} className="secondary">取り下げる</button>
            </div>
          )}
        </div>
      )}

      {/* 発注者向け応募者一覧 (open のとき) */}
      {isOwner && quest.status === 'open' && (
        <section style={{ marginTop: '1.4em' }}>
          <h3 style={{ fontSize: '0.95em' }}>応募者 ({applications?.length ?? 0})</h3>
          {!applications && <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中...</p>}
          {applications && applications.length === 0 && (
            <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>まだ応募がありません。</p>
          )}
          {applications && applications.map(a => (
            <div key={a.uri} className="dq-window compact">
              <p style={{ margin: 0, fontSize: '0.8em', color: 'var(--color-muted)' }}>
                <Handle did={a.did} /> - {new Date(a.createdAt).toLocaleString()}
              </p>
              <p style={{ margin: '0.3em 0', fontSize: '0.9em', whiteSpace: 'pre-wrap' }}>{a.message}</p>
              <button onClick={() => onAssign(a.did)} disabled={busy}>受託者に指定</button>
            </div>
          ))}
        </section>
      )}

      {/* assigned 中: 受託者の表示 + 受託者の完了報告ボタン */}
      {(quest.status === 'assigned' || quest.status === 'reported') && quest.assignee && (
        <section style={{ marginTop: '1.4em' }}>
          <p style={{ fontSize: '0.85em' }}>
            受託者: <strong><Handle did={quest.assignee} /></strong>
            {quest.status === 'reported' && ' (完了報告済み、承認待ち)'}
          </p>
          {isAssignee && quest.status === 'assigned' && (
            <button onClick={onReport} disabled={busy}>完了を報告する</button>
          )}
          {isOwner && quest.status === 'reported' && (
            <div style={{ display: 'flex', gap: '0.6em', marginTop: '0.4em' }}>
              <button onClick={onApprove} disabled={busy}>承認する (報酬を発行)</button>
              <button onClick={onRevision} disabled={busy} className="secondary">やり直しを依頼</button>
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
