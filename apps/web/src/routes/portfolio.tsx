/**
 * ポートフォリオ画面 (docs/15-user-quest.md §UI 設計 D)。
 *
 * Phase 2 MVP:
 *  - 受託履歴 (完了済み) + 受託サマリ (受託総数 / 成功 / 失敗 / キャンセル / 関わった発注者数)
 *  - 発注履歴 + サマリ (発注総数 / success / failure / cancelled / 何人に発行 / 累計発行 pt)
 *  - 自分が完了済みで受け取ったポイントの種類別表示 (= 発注者別)
 *
 * Phase 3 で拡張: シェア% 表示 (他人 PDS から発行者総量取得が必要)、
 *               公開ポートフォリオ (他人視点) 表示の opt-out
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AtpAgent, Agent } from '@atproto/api';
import {
  summarize,
  distinctRecipients,
  distinctRequesters,
  questXpEarned,
  type UserQuest,
  type OutcomeSummary,
} from '@aozoraquest/core';
import { RadarChart } from '@/components/radar-chart';
import { useSession } from '@/lib/session';
import {
  listIssuedQuests,
  listMyApplications,
  getQuest,
  questPath,
} from '@/lib/quest-api';
import { Handle, RewardPoints } from '@/components/handle';

const PUBLIC_APPVIEW = 'https://api.bsky.app';

export function Portfolio() {
  const session = useSession();
  return <PortfolioView did={session.did ?? null} agent={session.agent ?? null} isSelf={true} signedIn={session.status === 'signed-in'} />;
}

/**
 * 他人の公開ポートフォリオ画面 (`/profile/:handle/portfolio`)。
 * handle → did 解決して PortfolioView に渡す。サインインなしでも閲覧可能。
 */
export function PublicPortfolio() {
  const { handle } = useParams<{ handle: string }>();
  const session = useSession();
  const [did, setDid] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    const agent = new AtpAgent({ service: PUBLIC_APPVIEW });
    agent.getProfile({ actor: handle })
      .then((res) => { if (!cancelled) setDid(res.data.did); })
      .catch((e) => { if (!cancelled) setResolveErr(String((e as Error)?.message ?? e)); });
    return () => { cancelled = true; };
  }, [handle]);

  if (!handle) return <p>URL が壊れています。</p>;
  if (resolveErr) return <p style={{ color: 'var(--color-danger)' }}>解決に失敗: {resolveErr}</p>;
  if (!did) return <p style={{ fontSize: '0.9em', color: 'var(--color-muted)' }}>読み込み中...</p>;

  // 他人視点では session.agent (= 認証済み) があれば listRecords は通る。
  // 公開 read だけなら publicAgent でも十分だが、認証済みエージェントを優先する。
  // AtpAgent と Agent は内部実装が同等なので、PortfolioView 側では unknown 経由で受ける。
  const agent: Agent = session.agent ?? (new AtpAgent({ service: PUBLIC_APPVIEW }) as unknown as Agent);
  const isSelf = session.did === did;
  return <PortfolioView did={did} agent={agent} isSelf={isSelf} signedIn={session.status === 'signed-in'} />;
}

interface PortfolioViewProps {
  did: string | null;
  agent: Agent | null;
  isSelf: boolean;
  signedIn: boolean;
}

function PortfolioView({ did, agent, isSelf, signedIn }: PortfolioViewProps) {
  const [issued, setIssued] = useState<UserQuest[] | null>(null);
  const [received, setReceived] = useState<UserQuest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!agent || !did) return;
    let cancelled = false;
    (async () => {
      try {
        const myIssued = await listIssuedQuests(agent, did);
        if (!cancelled) setIssued(myIssued);

        // 受託: 自分の applications から quest URI を集めて、それぞれ resolve
        const apps = await listMyApplications(agent, did);
        const questUris = Array.from(new Set(apps.map(a => a.questUri)));
        const fetched: UserQuest[] = [];
        for (const u of questUris) {
          try {
            const q = await getQuest(agent, u);
            if (q && q.assignee === did) fetched.push(q);
          } catch (e) {
            console.warn('[portfolio] resolve received quest failed', u, e);
          }
        }
        if (!cancelled) setReceived(fetched);
      } catch (e) {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => { cancelled = true; };
  }, [did, agent]);

  const issuedSummary: OutcomeSummary | null = issued ? summarize(issued) : null;
  const receivedSummary: OutcomeSummary | null = received ? summarize(received) : null;

  const completedIssued = useMemo(() => (issued ?? []).filter(q => q.status === 'completed'), [issued]);
  const completedReceived = useMemo(() => (received ?? []).filter(q => q.status === 'completed'), [received]);
  // 受託して完了したクエストから得た累計ステータス XP (完了集合からの派生)。
  const questXp = useMemo(() => questXpEarned(received ?? [], did ?? ''), [received, did]);
  const questXpTotal = questXp.atk + questXp.def + questXp.agi + questXp.int + questXp.luk;

  /** 受託者視点: 発注者 DID → 獲得 pt の合計 */
  const receivedByIssuer = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of completedReceived) {
      map.set(q.did, (map.get(q.did) ?? 0) + q.rewardPoints);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [completedReceived]);

  const totalIssuedPower = useMemo(
    () => completedIssued.reduce((s, q) => s + q.rewardPoints, 0),
    [completedIssued],
  );

  if (isSelf && !signedIn) {
    return <p style={{ fontSize: '0.9em' }}>サインインしてください。</p>;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: '1.15em' }}>
        {isSelf ? 'ポートフォリオ' : <><Handle did={did ?? ''} suffix=" のポートフォリオ" /></>}
      </h2>
      <p style={{ fontSize: '0.85em' }}>
        <Link to="/board">← 掲示板へ戻る</Link>
      </p>

      {err && <p style={{ color: 'var(--color-danger)' }}>取得に失敗: {err}</p>}

      <section style={{ marginTop: '1em' }} className="dq-window">
        <h3 style={{ marginTop: 0, fontSize: '0.95em' }}>発注サマリ (出したクエスト)</h3>
        {!issuedSummary ? (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中...</p>
        ) : (
          <SummaryGrid s={issuedSummary} />
        )}
        {issued && (
          <p style={{ fontSize: '0.85em', marginTop: '0.6em' }}>
            完了したクエストで <strong>{distinctRecipients(issued)} 人</strong> に
            自分発行ポイントを渡しました (累計{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>
              {totalIssuedPower.toLocaleString()} pt
            </span>
            )。
          </p>
        )}
      </section>

      <section style={{ marginTop: '1em' }} className="dq-window">
        <h3 style={{ marginTop: 0, fontSize: '0.95em' }}>受託サマリ (うけたクエスト)</h3>
        {!receivedSummary ? (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>読み込み中...</p>
        ) : (
          <SummaryGrid s={receivedSummary} />
        )}
        {received && (
          <p style={{ fontSize: '0.85em', marginTop: '0.6em' }}>
            <strong>{distinctRequesters(received)} 人</strong> の発注者から受託しました。
          </p>
        )}
      </section>

      {questXpTotal > 0 && (
        <section style={{ marginTop: '1em' }} className="dq-window">
          <h3 style={{ marginTop: 0, fontSize: '0.95em' }}>クエストで得たステータス XP</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1em', flexWrap: 'wrap' }}>
            <RadarChart stats={questXp} size={140} normalize showValues />
            <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
              受託して完了したクエストの内容 (タグ) に応じて、各ステータスに合計
              <strong style={{ color: 'var(--color-accent)' }}> {questXpTotal.toLocaleString()} XP</strong> を獲得。
            </div>
          </div>
        </section>
      )}

      {receivedByIssuer.length > 0 && (
        <section style={{ marginTop: '1em' }} className="dq-window">
          <h3 style={{ marginTop: 0, fontSize: '0.95em' }}>保有ポイント (発行者別)</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {receivedByIssuer.map(([did, pt]) => (
              <li key={did} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3em 0', borderBottom: '1px dotted rgba(255,255,255,0.1)' }}>
                <span><Handle did={did} suffix="ポイント" /></span>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>
                  {pt.toLocaleString()} pt
                </span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.5em' }}>
            シェア% (= 発行者の総発行量に対する保有割合) は Phase 3 で表示予定。
          </p>
        </section>
      )}

      {completedIssued.length > 0 && (
        <section style={{ marginTop: '1em' }}>
          <h3 style={{ fontSize: '0.95em' }}>完了した発注 ({completedIssued.length})</h3>
          <QuestHistoryList quests={completedIssued} />
        </section>
      )}

      {completedReceived.length > 0 && (
        <section style={{ marginTop: '1em' }}>
          <h3 style={{ fontSize: '0.95em' }}>完了した受託 ({completedReceived.length})</h3>
          <QuestHistoryList quests={completedReceived} />
        </section>
      )}
    </div>
  );
}

function SummaryGrid({ s }: { s: OutcomeSummary }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5em', fontSize: '0.85em' }}>
      <Stat label="総数" v={s.total} />
      <Stat label="成功" v={s.success} accent />
      <Stat label="失敗" v={s.failure} danger={s.failure > 0} />
      <Stat label="ｷｬﾝｾﾙ" v={s.cancelled} />
      <Stat label="進行中" v={s.inProgress} />
    </div>
  );
}

function Stat({ label, v, accent, danger }: { label: string; v: number; accent?: boolean; danger?: boolean }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '0.7em', color: 'var(--color-muted)' }}>{label}</div>
      <div style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: '1.2em',
        color: danger ? 'var(--color-danger)' : accent ? 'var(--color-accent)' : 'var(--color-fg)',
      }}>{v}</div>
    </div>
  );
}

function QuestHistoryList({ quests }: { quests: UserQuest[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {quests.map(q => (
        <li key={q.uri}>
          <Link to={questPath(q.uri)} style={{ textDecoration: 'none' }}>
            <div className="dq-window compact" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ color: 'var(--color-fg)', fontSize: '0.9em' }}>{q.title}</span>
              <span style={{ fontSize: '0.75em', fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)' }}>
                <RewardPoints did={q.did} points={q.rewardPoints} />
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

