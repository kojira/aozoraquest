/**
 * 依頼クエスト掲示板の表示部品 (routes/board.tsx と workspace の board カラムで共用)。
 *
 * filter は `{ kind, param }` だけを見るので、board-columns.ts の Column
 * (id あり) と app-columns.ts の BoardInner (id なし) の両方を受けられる。
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuestIndex, QuestIndexSummary } from '@/lib/quest-api';
import { listIssuedQuests, listMyApplications, listCompletionsFor, buildQuestIndexViaDiscovery, questPath } from '@/lib/quest-api';
import { getQuestIndexCached } from '@/lib/quest-index-cache';
import { needsRequesterApproval, effectiveState, effectiveStateForAssignee, questAssignees, questMaxAssignees, type EffectiveState, type UserQuest } from '@aozoraquest/core';
import { setQuestActionableCount } from '@/lib/quest-actionable';
import { useSession } from '@/lib/session';
import { useRuntimeConfig } from '@/components/config-provider';
import { RewardPoints } from '@/components/handle';

export interface BoardFilter {
  kind: 'open' | 'assigned' | 'mine' | 'applied' | 'tag' | 'job' | 'issuer';
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
  // 自分が発注したクエストのうち「受託者の完了報告が届き承認待ち」のもの。
  // status は受託者が書けず assigned のままなので、completion record から判定する。
  const [pendingApproval, setPendingApproval] = useState<UserQuest[]>([]);
  // 自分が受託したクエストの effective state (uri → state)。受託中カラムのカードで
  // 「あなたが報告する番 / 承認待ち / やり直し」を出し分けるのに使う。
  const [assigneeStates, setAssigneeStates] = useState<Map<string, EffectiveState>>(new Map());
  // 上記のうち「あなたが (再)完了報告する番」(IN_PROGRESS / REVISION_REQUESTED) のクエスト。
  // 発注者の pendingApproval と対称な、受託者向けの気づき導線 (ReportPendingBanner)。
  const [reportPending, setReportPending] = useState<UserQuest[]>([]);
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
      ? () => buildQuestIndexViaDiscovery(agent, directoryDids, selfDid)
      : undefined;
    getQuestIndexCached(builder)
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch((e) => { if (!cancelled) setErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, aggregationKey]);

  // 受託者視点: index から「自分が受託 (assignee==自分 かつ status==assigned)」の
  // クエストを拾い、completion を読んで effective state を出す。発注者の承認待ち判定
  // (下の effect) と対称。index ロード後に走る。
  useEffect(() => {
    if (!index || !selfDid) {
      setAssigneeStates(new Map());
      setReportPending([]);
      return;
    }
    const mine = index.quests.filter((q) => questAssignees(q).includes(selfDid) && q.status === 'assigned');
    if (mine.length === 0) {
      setAssigneeStates(new Map());
      setReportPending([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const states = new Map<string, EffectiveState>();
      const pend: UserQuest[] = [];
      await Promise.all(mine.map(async (s) => {
        const q = summaryToQuest(s);
        try {
          const comps = await listCompletionsFor(undefined, q);
          // 複数受託: 自分ぶんの状態だけを見る (他の受託者の進行は無関係)。
          const st = effectiveStateForAssignee(q, comps, selfDid);
          states.set(q.uri, st);
          if (st === 'IN_PROGRESS' || st === 'REVISION_REQUESTED') pend.push(q);
        } catch (e) {
          console.warn('[board] assignee effectiveState', e);
          // 失敗時は「報告する番」に倒す (= 受託者が見落とすより、出して気づかせる)
          states.set(q.uri, 'IN_PROGRESS');
          pend.push(q);
        }
      }));
      if (!cancelled) {
        setAssigneeStates(states);
        setReportPending(pend);
      }
    })();
    return () => { cancelled = true; };
  }, [index, selfDid]);

  useEffect(() => {
    if (session.status !== 'signed-in' || !session.agent || !session.did) return;
    const agent = session.agent;
    const did = session.did;
    let cancelled = false;
    listIssuedQuests(agent, did)
      .then(async (qs) => {
        if (cancelled) return;
        setMyQuests(qs);
        // 承認待ち判定: assigned のクエストだけ completion を読み、受託者の報告が
        // 来ていて未承認のものを集める (status='reported' は PDS に書かれないため)。
        const candidates = qs.filter((q) => q.status === 'assigned');
        const checked = await Promise.all(
          candidates.map(async (q) => {
            try {
              const comps = await listCompletionsFor(undefined, q);
              return needsRequesterApproval(q, comps) ? q : null;
            } catch (e) {
              console.warn('[board] listCompletionsFor (pending approval)', e);
              return null;
            }
          }),
        );
        if (!cancelled) setPendingApproval(checked.filter((q): q is UserQuest => q !== null));
      })
      .catch((e) => { if (!cancelled) console.warn('[board] listIssuedQuests', e); });
    listMyApplications(agent, did)
      .then((apps) => {
        if (!cancelled) setMyApplicationQuestUris(new Set(apps.map(a => a.questUri)));
      })
      .catch((e) => { if (!cancelled) console.warn('[board] listMyApplications', e); });
    return () => { cancelled = true; };
  }, [session.status, session.agent, session.did]);

  // 「自分のアクション待ち件数」(承認待ち + 完了報告待ち) を共有ストアへ publish。
  // footer-nav の「クエスト」タブが赤カウントバッジで表示し、@mention を見逃しても気付ける。
  useEffect(() => {
    setQuestActionableCount(pendingApproval.length + reportPending.length);
  }, [pendingApproval, reportPending]);

  return { index, myQuests, myApplicationQuestUris, pendingApproval, assigneeStates, reportPending, err, sessionDid: session.did ?? null };
}

/** QuestIndexSummary を effectiveState / listCompletionsFor が必要とする最小 UserQuest に。
 *  これらは uri/did/status/assignee/deadline しか見ないので body 等はダミーで十分。 */
function summaryToQuest(s: QuestIndexSummary): UserQuest {
  const q: UserQuest = {
    uri: s.uri,
    did: s.did,
    title: s.title,
    body: '',
    tags: s.tags,
    visibility: 'public',
    status: s.status as UserQuest['status'],
    rewardPoints: s.rewardPoints,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
  };
  if (s.assignee !== undefined) q.assignee = s.assignee;
  if (s.assignees !== undefined) q.assignees = s.assignees;
  if (s.maxAssignees !== undefined) q.maxAssignees = s.maxAssignees;
  if (s.deadline !== undefined) q.deadline = s.deadline;
  return q;
}

export function filterForBoard(
  c: BoardFilter,
  index: QuestIndex | null,
  myQuests: UserQuest[] | null,
  myApplicationQuestUris: Set<string> | null,
  selfDid: string | null,
): QuestIndexSummary[] | null {
  if (c.kind === 'open') {
    if (!index) return null;
    return index.quests.filter(q => q.status === 'open');
  }
  if (c.kind === 'assigned') {
    // 自分が受託したクエスト (受託確定〜完了前)。status==='assigned' は受託者の
    // IN_PROGRESS / 承認待ち / 差し戻し をすべて含む (発注者が承認すると completed に
    // 抜ける)。これが無いと受託者は受託後にクエストを見失い完了報告に到達できない。
    if (!index) return null;
    if (!selfDid) return [];
    return index.quests.filter(q => questAssignees(q).includes(selfDid) && q.status === 'assigned');
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

/** 受託者カードの状態バッジ文言 (あなたの番かどうか)。null なら出さない。 */
function assigneeBadge(state: EffectiveState): { text: string; accent: boolean } | null {
  if (state === 'IN_PROGRESS')        return { text: '● あなたが完了報告する番', accent: true };
  if (state === 'REVISION_REQUESTED') return { text: '● やり直し依頼 — 再報告する番', accent: true };
  if (state === 'AWAITING_APPROVAL')  return { text: '承認待ち（相手の番）', accent: false };
  return null;
}

export function QuestCard({ summary, expired, needsApproval, assigneeState }: { summary: QuestIndexSummary; expired?: boolean; needsApproval?: boolean; assigneeState?: EffectiveState }) {
  const badge = assigneeState ? assigneeBadge(assigneeState) : null;
  // あなたの番 (発注者=承認 / 受託者=報告) のときカードを accent 強調する。
  const myTurn = needsApproval || (badge?.accent ?? false);
  return (
    <Link to={questPath(summary.uri)} style={{ textDecoration: 'none' }}>
      <div className="dq-window compact" style={{ borderColor: myTurn ? 'var(--color-accent)' : expired ? 'var(--color-muted)' : undefined }}>
        {needsApproval && (
          // 発注者の「完了報告が来た = 承認すれば達成」を見逃さないための強調バッジ
          <div style={{ fontSize: '0.72em', fontWeight: 700, color: 'var(--color-accent)', marginBottom: '0.2em' }}>
            ● 承認待ち（完了報告が届いています）
          </div>
        )}
        {!needsApproval && badge && (
          // 受託者の「自分の番か / 相手待ちか」を一覧で示す (発注者バッジと対称)
          <div style={{ fontSize: '0.72em', fontWeight: badge.accent ? 700 : 400, color: badge.accent ? 'var(--color-accent)' : 'var(--color-muted)', marginBottom: '0.2em' }}>
            {badge.text}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5em' }}>
          <div style={{ fontWeight: 700, fontSize: '0.92em', color: 'var(--color-fg)' }}>{summary.title}</div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78em', color: 'var(--color-accent)', whiteSpace: 'nowrap' }}>
            <RewardPoints did={summary.did} points={summary.rewardPoints} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.72em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
          {summary.tags.slice(0, 3).map(t => <span key={t}>#{t.replace(/^#/, '')}</span>)}
          {questMaxAssignees(summary) > 1 && (
            // 複数受託クエスト: 確定済み人数 / 上限を示す (募集枠の埋まり具合)
            <span title="受託者数 / 上限">👥 {questAssignees(summary).length}/{questMaxAssignees(summary)}</span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            {expired ? '期限切れ' : summary.deadline ? `〆 ${formatDate(summary.deadline)}` : ''}
            {/* needsApproval / assignee バッジが状態を示すときは muted ラベルを重複させない */}
            {!needsApproval && !badge && summary.status !== 'open' && <span style={{ marginLeft: '0.6em' }}>{labelOf(summary.status)}</span>}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** 承認待ちが 1 件以上あるとき、掲示板上部に出す気づき導線。
 *  `pending` は useBoardData が completion record から算出済み (status には依存しない)。
 *  各クエストへ直リンクし、詳細画面 (board-detail) で承認できる。 */
export function ApprovalPendingBanner({ pending }: { pending: UserQuest[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="dq-window compact" style={{ borderColor: 'var(--color-accent)', background: 'rgba(159,215,255,0.08)', marginBottom: '0.5em' }}>
      <div style={{ fontSize: '0.85em', fontWeight: 700, color: 'var(--color-accent)' }}>
        ● 承認待ちが {pending.length} 件
      </div>
      <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.2em' }}>
        完了報告が届いています。各クエストを開いて承認すると達成になります。
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.4em 0 0' }}>
        {pending.map((q) => (
          <li key={q.uri} style={{ marginTop: '0.25em' }}>
            <Link to={questPath(q.uri)} style={{ fontSize: '0.82em', wordBreak: 'break-word' }}>
              「{q.title}」を承認する →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 受託者の「(再)完了報告する番」が 1 件以上あるとき、掲示板上部に出す気づき導線。
 *  発注者の ApprovalPendingBanner と対称。`pending` は useBoardData が completion record
 *  から effectiveState で算出済み (IN_PROGRESS / REVISION_REQUESTED)。 */
export function ReportPendingBanner({ pending }: { pending: UserQuest[] }) {
  if (pending.length === 0) return null;
  return (
    <div className="dq-window compact" style={{ borderColor: 'var(--color-accent)', background: 'rgba(159,215,255,0.08)', marginBottom: '0.5em' }}>
      <div style={{ fontSize: '0.85em', fontWeight: 700, color: 'var(--color-accent)' }}>
        ● あなたが完了報告する番が {pending.length} 件
      </div>
      <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.2em' }}>
        受託したクエストです。作業が終わったら各クエストを開いて「完了を報告」しましょう。
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.4em 0 0' }}>
        {pending.map((q) => (
          <li key={q.uri} style={{ marginTop: '0.25em' }}>
            <Link to={questPath(q.uri)} style={{ fontSize: '0.82em', wordBreak: 'break-word' }}>
              「{q.title}」を報告する →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function emptyMessageForBoard(c: BoardFilter): string {
  switch (c.kind) {
    case 'open':    return 'まだ誰も募集していません。「クエストを出す」から始めてみましょう。';
    case 'assigned': return '受託中のクエストはありません。募集中から応募してみましょう。';
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
    case 'assigned': return '受託中';
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
