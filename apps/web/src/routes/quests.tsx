/**
 * クエスト履歴画面 (/quests)
 *
 * 今日のクエストとログ、それと過去 14 日分のサマリ + 詳細展開を表示する。
 * 履歴は PDS の `app.aozoraquest.questLog` collection から listRecords で
 * 取得 (rkey = YYYY-MM-DD, sorted desc が default)。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult, Quest, StatVector } from '@aozoraquest/core';
import {
  ARCHETYPES,
  DEFAULT_QUEST_TEMPLATES,
  JOBS_BY_ID,
  actionLabel,
  generateDailyQuests,
  jobDisplayName,
  statArrayToVector,
} from '@aozoraquest/core';
import { useSession } from '@/lib/session';
import { COL } from '@/lib/collections';
import { getRecord } from '@/lib/atproto';
import { ensureTodayQuestLog, type ActivityEntry, type QuestLogEntry, type QuestLogRecord } from '@/lib/post-processor';
import { useOnPosted } from '@/components/compose-modal';

interface ProfileRecord {
  targetJob?: string;
}

const HISTORY_LIMIT = 14; // 過去何日分を取るか

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isQuestDone(q: Pick<QuestLogEntry, 'requiredCount' | 'currentCount'>): boolean {
  return q.requiredCount > 0 && q.currentCount >= q.requiredCount;
}

function templateById(id: string) {
  return DEFAULT_QUEST_TEMPLATES.find((t) => t.id === id);
}

/** stored QuestLogEntry を表示用 Quest に戻す (description が PDS 側に無いので template から再構築)。 */
function entryToQuest(e: QuestLogEntry, today: Quest[]): Quest {
  const tmpl = templateById(e.templateId);
  const todayMatch = today.find((t) => t.id === e.id);
  const description =
    todayMatch?.description ??
    tmpl?.descriptionTemplate.replace('{N}', String(e.requiredCount)) ??
    e.templateId;
  return {
    id: e.id,
    templateId: e.templateId,
    type: e.type,
    targetStat: e.targetStat,
    description,
    requiredCount: e.requiredCount,
    currentCount: e.currentCount,
    xpReward: tmpl?.xpRewardFn(e.currentCount) ?? 0,
    issuedDate: todayMatch?.issuedDate ?? '',
  };
}

export function Quests() {
  const session = useSession();
  const agent = session.agent;
  const did = session.did;

  const [selfDiag, setSelfDiag] = useState<DiagnosisResult | null>(null);
  const [targetJobId, setTargetJobId] = useState<string | null>(null);
  const [history, setHistory] = useState<QuestLogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetStats: StatVector | null = useMemo(() => {
    if (!targetJobId) return null;
    if (!(targetJobId in JOBS_BY_ID)) return null;
    return statArrayToVector(JOBS_BY_ID[targetJobId as keyof typeof JOBS_BY_ID].stats);
  }, [targetJobId]);

  // 今日のクエストを (まだ無ければ) 生成 + ログ初期化
  const generatedToday: Quest[] = useMemo(() => {
    if (!selfDiag || !targetStats || !did) return [];
    return generateDailyQuests({
      userDid: did,
      dateStr: todayDateString(),
      level: 1,
      currentStats: selfDiag.rpgStats,
      targetStats,
      recentTemplateIds: [],
    });
  }, [selfDiag, targetStats, did]);

  // 自分の analysis + profile (target job) ロード
  useEffect(() => {
    if (!agent || !did) return;
    let cancelled = false;
    (async () => {
      try {
        const [diag, prof] = await Promise.all([
          getRecord<DiagnosisResult>(agent, did, COL.analysis, 'self').catch(() => null),
          getRecord<ProfileRecord>(agent, did, COL.profile, 'self').catch(() => null),
        ]);
        if (cancelled) return;
        if (diag) setSelfDiag(diag);
        const tj = prof?.targetJob;
        if (tj && (ARCHETYPES as readonly string[]).includes(tj)) setTargetJobId(tj);
      } catch (e) {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  // 履歴ロード (今日含む直近 14 日分)
  useEffect(() => {
    if (!agent || !did) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection: COL.questLog,
          limit: HISTORY_LIMIT,
        });
        if (cancelled) return;
        const records = res.data.records
          .map((r) => r.value as unknown as QuestLogRecord)
          .filter((v): v is QuestLogRecord => !!v && typeof v.date === 'string')
          .sort((a, b) => (a.date < b.date ? 1 : -1)); // 新しい順
        setHistory(records);
      } catch (e) {
        if (!cancelled) setErr(String((e as Error)?.message ?? e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  // 今日のクエストを log に初期化 (ホーム経由でも初期化されるが、この画面から開いたときも保証)
  useEffect(() => {
    if (!agent || !did || generatedToday.length === 0) return;
    let cancelled = false;
    (async () => {
      const rec = await ensureTodayQuestLog(agent, did, generatedToday);
      if (cancelled) return;
      // 履歴にも反映 (今日分が無ければ先頭に追加 / 既にあれば差し替え)
      setHistory((prev) => {
        const today = todayDateString();
        const without = prev.filter((r) => r.date !== today);
        return [rec, ...without];
      });
    })().catch((e) => console.warn('ensure questLog failed', e));
    return () => {
      cancelled = true;
    };
  }, [agent, did, generatedToday]);

  // 投稿後に今日分を再フェッチ
  useOnPosted(() => {
    if (!agent || !did) return;
    setTimeout(() => {
      const today = todayDateString();
      getRecord<QuestLogRecord>(agent, did, COL.questLog, today)
        .then((rec) => {
          if (!rec) return;
          setHistory((prev) => {
            const without = prev.filter((r) => r.date !== today);
            return [rec, ...without];
          });
        })
        .catch(() => {});
    }, 400);
  });

  if (session.status === 'loading') return <p>準備しています...</p>;
  if (session.status === 'signed-out') {
    return (
      <div>
        <h2>クエスト</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          ログインすると、毎日のクエストとログを見られます。
        </p>
        <Link to="/onboarding">
          <button style={{ marginTop: '1em' }}>ログインして始める</button>
        </Link>
      </div>
    );
  }

  if (!selfDiag) {
    return (
      <div>
        <h2>クエスト</h2>
        <p>
          まだあなたの気質を調べていません。
          <Link to="/me" style={{ marginLeft: '0.4em' }}>
            自分のページ
          </Link>{' '}
          から調べると、ここに毎日のクエストが出ます。
        </p>
      </div>
    );
  }
  if (!targetStats) {
    return (
      <div>
        <h2>クエスト</h2>
        <p>
          <Link to="/settings">目指す姿</Link> を選ぶと、そこへ近づくための毎日のクエストが出ます。
        </p>
      </div>
    );
  }

  const todayStr = todayDateString();

  return (
    <div>
      <h2>クエスト</h2>
      <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', marginTop: 0 }}>
        目指す:{' '}
        {targetJobId
          ? jobDisplayName(targetJobId as keyof typeof JOBS_BY_ID, 'default')
          : '—'}{' '}
        / 累計 {history.length} 日分の記録
      </p>

      {err && <p style={{ color: 'var(--color-danger)' }}>うまく読み込めませんでした: {err}</p>}
      {loading && history.length === 0 && <p style={{ color: 'var(--color-muted)' }}>読み込み中...</p>}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
        {history.map((rec) => (
          <li key={rec.date}>
            <DayCard rec={rec} today={generatedToday} isToday={rec.date === todayStr} />
          </li>
        ))}
      </ul>
      {!loading && history.length === 0 && !err && (
        <p style={{ color: 'var(--color-muted)' }}>
          まだクエストの記録がありません。投稿するとここに溜まっていきます。
        </p>
      )}
    </div>
  );
}

function DayCard({ rec, today, isToday }: { rec: QuestLogRecord; today: Quest[]; isToday: boolean }) {
  // 今日は最初から開く、過去日は折りたたみ
  const [open, setOpen] = useState(isToday);

  const quests = rec.quests.map((e) => entryToQuest(e, today));
  const doneCount = quests.filter(isQuestDone).length;
  const total = quests.length;
  const xp = rec.totalXpGained ?? 0;
  const activityCount = rec.activity?.length ?? 0;

  return (
    <section
      className="dq-window"
      style={{
        padding: '0.6em 0.8em',
        ...(isToday ? { outline: '2px solid var(--color-accent)', outlineOffset: -2 } : {}),
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: '0.2em 0',
          color: 'var(--color-fg)',
          font: 'inherit',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6em',
          cursor: 'pointer',
          boxShadow: 'none',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{rec.date}</span>
        {isToday && (
          <span
            style={{
              fontSize: '0.7em',
              padding: '0.05em 0.4em',
              background: 'var(--color-accent)',
              color: '#0a1528',
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            今日
          </span>
        )}
        <span style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>
          達成 {doneCount}/{total}
        </span>
        {xp > 0 && (
          <span style={{ fontSize: '0.85em', color: 'var(--color-accent)', fontFamily: 'ui-monospace, monospace' }}>
            +{xp} XP
          </span>
        )}
        {activityCount > 0 && (
          <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>
            行動 {activityCount}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--color-muted)' }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.5em 0 0', display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
            {quests.map((q) => (
              <li key={q.id}>
                <QuestRow quest={q} />
              </li>
            ))}
          </ul>
          {rec.activity && rec.activity.length > 0 && (
            <details style={{ marginTop: '0.6em' }}>
              <summary style={{ fontSize: '0.8em', color: 'var(--color-muted)', cursor: 'pointer' }}>
                行動ログ ({rec.activity.length})
              </summary>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0.4em 0 0', display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
                {[...rec.activity].reverse().map((e, i) => (
                  <li key={i}>
                    <ActivityRow entry={e} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function QuestRow({ quest }: { quest: Quest }) {
  const progress = quest.requiredCount > 0 ? Math.min(1, quest.currentCount / quest.requiredCount) : 0;
  const done = isQuestDone(quest);
  const typeBadge = { growth: '成長', maintenance: '維持', restraint: '節制' }[quest.type];
  const typeColor = {
    growth: 'var(--color-accent)',
    maintenance: 'var(--color-muted)',
    restraint: 'var(--color-agi)',
  }[quest.type];

  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 4,
        padding: '0.4em 0.5em',
        ...(done ? { opacity: 0.55 } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '0.7em',
            padding: '0.05em 0.4em',
            border: `1px solid ${typeColor}`,
            color: typeColor,
            borderRadius: 2,
          }}
        >
          {typeBadge}
        </span>
        {done && (
          <span
            style={{
              fontSize: '0.7em',
              padding: '0.05em 0.4em',
              background: 'var(--color-accent)',
              color: '#0a1528',
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            達成!
          </span>
        )}
        <span style={{ fontSize: '0.9em', ...(done ? { textDecoration: 'line-through' } : {}) }}>
          {quest.description}
        </span>
      </div>
      {quest.requiredCount > 0 && (
        <div style={{ marginTop: '0.4em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <div style={{ flex: 1, height: 4, background: 'rgba(28,43,68,0.3)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: typeColor }} />
          </div>
          <span style={{ fontSize: '0.75em', color: '#869', minWidth: '2.5em', textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
            {quest.currentCount}/{quest.requiredCount}
          </span>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const time = (() => {
    try {
      return new Date(entry.at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();
  const actionText = actionLabel(entry.action);
  const types = entry.actionTypes ?? (entry.action ? [entry.action] : []);
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 4,
        padding: '0.35em 0.5em',
        fontSize: '0.78em',
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', gap: '0.5em', color: 'var(--color-muted)', fontSize: '0.9em', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{time}</span>
        <span>→</span>
        <span style={{ color: entry.action ? 'var(--color-accent)' : 'var(--color-muted)' }}>{actionText}</span>
        {types.length > 1 && (
          <span style={{ color: 'var(--color-muted)', fontSize: '0.85em' }}>
            ({types.join(' / ')})
          </span>
        )}
      </div>
      <div style={{ marginTop: '0.2em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        「{entry.preview}」
      </div>
      {entry.incremented.length > 0 ? (
        <div style={{ marginTop: '0.2em', color: 'var(--color-muted)' }}>
          +1: {entry.incremented.join(' / ')}
        </div>
      ) : (
        <div style={{ marginTop: '0.2em', color: 'var(--color-muted)' }}>
          {entry.action ? '該当クエスト無し' : '分類できず'}
        </div>
      )}
    </div>
  );
}
