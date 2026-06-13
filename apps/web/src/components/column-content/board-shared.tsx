/**
 * 依頼クエスト掲示板の表示部品 (routes/board.tsx と workspace の board カラムで共用)。
 *
 * filter は `{ kind, param }` だけを見るので、board-columns.ts の Column
 * (id あり) と app-columns.ts の BoardInner (id なし) の両方を受けられる。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuestIndex, QuestIndexSummary } from '@/lib/quest-api';
import { listIssuedQuests, listMyApplications, buildQuestIndexFromDirectory } from '@/lib/quest-api';
import { getQuestIndexCached } from '@/lib/quest-index-cache';
import type { UserQuest } from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { useRuntimeConfig } from '@/components/config-provider';
import { Handle } from '@/components/handle';

export interface BoardFilter {
  kind: 'open' | 'mine' | 'applied' | 'tag' | 'job' | 'issuer';
  param?: string;
}

/** board 表示に必要なデータ一式を fetch する hook
 *  (index は quest-index-cache で重複防止)。 */
export function useBoardData() {
  const session = useSession();
  const config = useRuntimeConfig();
  const [index, setIndex] = useState<QuestIndex | null>(null);
  const [myQuests, setMyQuests] = useState<UserQuest[] | null>(null);
  const [myApplicationQuestUris, setMyApplicationQuestUris] = useState<Set<string> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 集約 Worker が未デプロイの間は、発見ディレクトリの DID 群 (+ 自分) から
  // クライアント集約して quest を全員に見えるようにする。サインインしている
  // ときだけ実 agent で各 PDS を読める (未サインインは従来 fallback)。
  const directoryDids = config.directory.map((u) => u.did);
  const agent = session.agent;
  const selfDid = session.did;
  // 依存値を文字列化して effect の不要再実行を防ぐ
  const aggregationKey = `${selfDid ?? ''}|${directoryDids.join(',')}`;

  useEffect(() => {
    let cancelled = false;
    const builder = agent
      ? () => {
          const dids = selfDid ? [selfDid, ...directoryDids] : directoryDids;
          return buildQuestIndexFromDirectory(agent, dids);
        }
      : undefined;
    getQuestIndexCached(builder)
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, aggregationKey]);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    listIssuedQuests(agent, did)
      .then((qs) => { if (!cancelled) setMyQuests(qs); })
      .catch((e) => { if (!cancelled) console.warn('[board] listIssuedQuests', e); });
    listMyApplications(agent, did)
      .then((apps) => {
        if (!cancelled) setMyApplicationQuestUris(new Set(apps.map(a => a.questUri)));
      })
      .catch((e) => { if (!cancelled) console.warn('[board] listMyApplications', e); });
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  return { index, myQuests, myApplicationQuestUris, err, sessionDid: session.did ?? null };
}

export function filterForBoard(
  c: BoardFilter,
  index: QuestIndex | null,
  myQuests: UserQuest[] | null,
  myApplicationQuestUris: Set<string> | null,
): QuestIndexSummary[] | null {
  if (c.kind === 'open') {
    if (!index) return null;
    return index.quests.filter(q => q.status === 'open');
  }
  if (c.kind === 'mine') {
    if (!myQuests) return null;
    return myQuests.map(toSummary);
  }
  if (c.kind === 'applied') {
    if (!index || !myApplicationQuestUris) return null;
    return index.quests.filter(q => myApplicationQuestUris.has(q.uri));
  }
  if (c.kind === 'tag') {
    if (!index || !c.param) return null;
    const target = c.param.replace(/^#/, '').toLowerCase();
    return index.quests.filter(q =>
      q.status === 'open' &&
      q.tags.some(t => t.replace(/^#/, '').toLowerCase() === target),
    );
  }
  if (c.kind === 'job') {
    // questIndex には targetJob を載せていないため、自分が出したクエストからのみ
    // filter する (questIndex への targetJob 追加は docs/15-user-quest.md 参照)。
    if (!myQuests) return null;
    return myQuests
      .filter(q => q.status === 'open' && q.targetJob === c.param)
      .map(toSummary);
  }
  if (c.kind === 'issuer') {
    if (!index || !c.param) return null;
    return index.quests.filter(q => q.status === 'open' && q.did === c.param);
  }
  return [];
}

export function toSummary(q: UserQuest): QuestIndexSummary {
  const s: QuestIndexSummary = {
    uri: q.uri,
    did: q.did,
    title: q.title,
    tags: q.tags,
    rewardPoints: q.rewardPoints,
    status: q.status,
    createdAt: q.createdAt,
  };
  if (q.deadline !== undefined) s.deadline = q.deadline;
  return s;
}

export function isExpiredSummary(s: QuestIndexSummary): boolean {
  if (s.status !== 'open') return false;
  if (!s.deadline) return false;
  return new Date(s.deadline) < new Date();
}

export function QuestCard({ summary, expired }: { summary: QuestIndexSummary; expired?: boolean }) {
  return (
    <Link to={`/board/${encodeURIComponent(summary.uri)}`} style={{ textDecoration: 'none' }}>
      <div className="dq-window compact" style={{ borderColor: expired ? 'var(--color-muted)' : undefined }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em' }}>
          <div style={{ fontWeight: 700, fontSize: '0.92em', color: 'var(--color-fg)' }}>{summary.title}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78em', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
            <Handle did={summary.did} suffix="P" /> {summary.rewardPoints.toLocaleString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
          {summary.tags.slice(0, 3).map(t => <span key={t}>#{t.replace(/^#/, '')}</span>)}
          <span style={{ marginLeft: 'auto' }}>
            {expired ? '期限切れ' : summary.deadline ? `〆 ${formatDate(summary.deadline)}` : ''}
            {summary.status !== 'open' && <span style={{ marginLeft: '0.6em' }}>{labelOf(summary.status)}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function emptyMessageForBoard(c: BoardFilter): string {
  switch (c.kind) {
    case 'open':    return 'まだ誰も募集していません。「クエストを出す」から始めてみましょう。';
    case 'mine':    return 'あなたが発行したクエストはまだありません。';
    case 'applied': return '応募中のクエストはありません。';
    case 'tag':     return `#${c.param ?? ''} のクエストは見つかりませんでした。`;
    case 'job':     return `「${c.param ?? ''}」を求めるクエストはまだありません。`;
    case 'issuer':  return 'この発行者の募集中クエストはありません。';
  }
}

export function boardFilterTitle(c: BoardFilter): string {
  switch (c.kind) {
    case 'open':    return '募集中';
    case 'mine':    return '自分が出した';
    case 'applied': return '自分が応募した';
    case 'tag':     return `#${c.param ?? ''}`;
    case 'job':     return `求めるジョブ: ${c.param ?? ''}`;
    case 'issuer':  return '発行者別';
  }
}

export function labelOf(status: string): string {
  if (status === 'assigned') return '受託中';
  if (status === 'reported') return '完了報告中';
  if (status === 'completed') return '完了';
  if (status === 'cancelled') return 'キャンセル';
  return status;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
