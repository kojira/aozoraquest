/**
 * 依頼クエスト詳細画面 (docs/15-user-quest.md §UI 設計 C)。
 *
 * Phase 1 MVP: ヘッダー + 本文 + tags + 募集期限 + status + 発注者向け
 * 「キャンセル」「期限延長」のみ。応募・受託・完了は Phase 2 で追加する。
 */
import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { getQuest, parseAtUri } from '@/lib/quest-api';
import { mockIndex } from '@/lib/quest-mock';
import { putRecord } from '@/lib/atproto';
import { COL } from '@/lib/collections';
import { isExpired, type UserQuest } from '@aozoraquest/core';

export function BoardDetail() {
  const { uri: encoded } = useParams<{ uri: string }>();
  const session = useSession();
  const navigate = useNavigate();
  const uri = encoded ? decodeURIComponent(encoded) : null;
  const [quest, setQuest] = useState<UserQuest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uri || !session.agent) return;
    let cancelled = false;
    getQuest(session.agent, uri)
      .then((q) => { if (!cancelled) setQuest(q); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
  }, [uri, session.agent]);

  if (!uri) return <p>URL が壊れています。</p>;
  if (err) return <p style={{ color: 'var(--color-danger)' }}>取得に失敗: {err}</p>;
  if (!quest) return <p style={{ fontSize: '0.9em', color: 'var(--color-muted)' }}>読み込み中...</p>;

  const expired = isExpired(quest);
  const isOwner = session.did === quest.did;

  async function cancelQuest() {
    if (!session.agent || !quest || !isOwner) return;
    if (!confirm('このクエストをキャンセルしますか?')) return;
    setBusy(true);
    try {
      const { rkey } = parseAtUri(quest.uri);
      const next = { ...quest, status: 'cancelled' as const, updatedAt: new Date().toISOString() };
      const recordWithoutUri: Record<string, unknown> = { ...next, $type: COL.userQuest };
      delete recordWithoutUri.uri;
      delete recordWithoutUri.did;
      await putRecord(session.agent, COL.userQuest, rkey, recordWithoutUri);
      mockIndex.updateQuestStatus(quest.uri, 'cancelled');
      setQuest(next);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function extendDeadline() {
    if (!session.agent || !quest || !isOwner) return;
    const cur = quest.deadline ? toLocalInput(quest.deadline) : '';
    const next = prompt('新しい募集期限 (YYYY-MM-DDTHH:MM 形式)\n空欄で削除', cur);
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
      setQuest(updated);
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
        <span>発注者: {handleStub(quest.did)}</span>
        <span style={{ color: 'var(--color-accent)' }}>
          {handleStub(quest.did)}P {quest.rewardPoints.toLocaleString()}
        </span>
        <span style={{ marginLeft: 'auto' }}>{statusLabel(quest.status, expired)}</span>
      </div>

      <div style={{ marginTop: '0.6em', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{quest.body}</div>

      <div style={{ display: 'flex', gap: '0.4em', flexWrap: 'wrap', marginTop: '0.8em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
        {quest.tags.map((t) => <span key={t}>#{t}</span>)}
      </div>

      {quest.deadline && (
        <p style={{ marginTop: '0.6em', fontSize: '0.85em' }}>
          募集期限: {new Date(quest.deadline).toLocaleString()} {expired && <span style={{ color: 'var(--color-danger)' }}>(期限切れ)</span>}
        </p>
      )}

      {isOwner && quest.status === 'open' && (
        <div style={{ display: 'flex', gap: '0.6em', marginTop: '1em' }}>
          <button onClick={extendDeadline} disabled={busy}>募集期限を変更</button>
          <button onClick={cancelQuest} disabled={busy}>キャンセル</button>
        </div>
      )}

      {!isOwner && (
        <p style={{ marginTop: '1em', fontSize: '0.8em', color: 'var(--color-muted)' }}>
          応募機能は Phase 2 で実装予定です。今は Bluesky DM で発注者に直接連絡してください。
        </p>
      )}
    </div>
  );
}

function statusLabel(status: string, expired: boolean): string {
  if (expired) return '期限切れ';
  if (status === 'open') return '募集中';
  if (status === 'assigned') return '受託中';
  if (status === 'reported') return '完了報告中';
  if (status === 'completed') return '完了';
  if (status === 'cancelled') return 'キャンセル';
  return status;
}

function handleStub(did: string): string {
  return did.slice(0, 14).replace(/^did:plc:/, '');
}

function toLocalInput(iso: string): string {
  // datetime-local input は YYYY-MM-DDTHH:MM (no timezone)
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
