import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult, Quest, StatVector } from '@aozoraquest/core';
import { generateDailyQuests, jobDisplayName, jobTagline } from '@aozoraquest/core';
import { RadarChart } from './radar-chart';
import { SpiritBubble } from './spirit-bubble';
import { useOnPosted } from './compose-modal';
import { ensureTodayQuestLog, loadTodayQuestLog, type QuestLogRecord } from '@/lib/post-processor';

interface HomeSummaryProps {
  agent: Agent | null;
  diag: DiagnosisResult | null;
  userDid: string;
  /** 目指すジョブのステータス配分。未設定ならクエストは生成しない。 */
  targetStats?: StatVector | null;
}

/**
 * ホーム上部のサマリー。
 *
 * 設計原則 (07-ui-design.md §1):
 *   静的な情報 (ジョブ名・絶対値ステータス) は常時大きく出さない。
 *   動的な情報 (今日のクエスト) を前面に。
 *
 * レイアウト:
 * - 静的: 折り畳み。閉じたら 1 行のジョブ名のみ。開くと小さなレーダー + ステータス要約。
 * - 動的 (今日のクエスト): 常時表示。
 */
export function HomeSummary({ agent, diag, userDid, targetStats }: HomeSummaryProps) {
  const [open, setOpen] = useState(false);
  const [questLog, setQuestLog] = useState<QuestLogRecord | null>(null);

  const generatedQuests: Quest[] = useMemo(() => {
    if (!diag || !targetStats) return [];
    const today = new Date();
    const dateStr =
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return generateDailyQuests({
      userDid,
      dateStr,
      level: 1,
      currentStats: diag.rpgStats,
      targetStats,
      recentTemplateIds: [],
    });
  }, [diag, userDid, targetStats]);

  // PDS の questLog から進捗を反映する。無ければ generatedQuests で初期化。
  useEffect(() => {
    if (!agent || !userDid || generatedQuests.length === 0) return;
    let cancelled = false;
    (async () => {
      const rec = await ensureTodayQuestLog(agent, userDid, generatedQuests);
      if (!cancelled) setQuestLog(rec);
    })().catch((e) => console.warn('ensure questLog failed', e));
    return () => { cancelled = true; };
  }, [agent, userDid, generatedQuests]);

  // 投稿直後に questLog を再フェッチして進捗反映
  useOnPosted(() => {
    if (!agent || !userDid) return;
    setTimeout(() => {
      loadTodayQuestLog(agent, userDid).then((rec) => {
        if (rec) setQuestLog(rec);
      }).catch((e) => console.warn('reload questLog failed', e));
    }, 300);
  });

  // 表示用クエスト: questLog があればそちらを優先、無ければ generatedQuests
  const quests: Quest[] = useMemo(() => {
    if (questLog) {
      return questLog.quests.map<Quest>((q) => {
        const gq = generatedQuests.find((g) => g.id === q.id);
        return {
          id: q.id,
          templateId: q.templateId,
          type: q.type,
          targetStat: q.targetStat,
          description: gq?.description ?? '',
          requiredCount: q.requiredCount,
          currentCount: q.currentCount,
          xpReward: gq?.xpReward ?? 0,
          issuedDate: gq?.issuedDate ?? (questLog.date ?? ''),
          ...(gq?.forbiddenActionTypes ? { forbiddenActionTypes: gq.forbiddenActionTypes } : {}),
        };
      });
    }
    return generatedQuests;
  }, [questLog, generatedQuests]);

  if (!diag) {
    return (
      <section className="dq-window" style={{ fontSize: '0.9em' }}>
        <p style={{ margin: 0 }}>
          まだあなたの気質を調べていません。
          <Link to="/me" style={{ marginLeft: '0.4em' }}>自分のページ</Link> から調べると、
          ここに今日のクエストが出ます。
        </p>
      </section>
    );
  }

  const jobName = jobDisplayName(diag.archetype, 'default');
  const tagline = jobTagline(diag.archetype);

  return (
    <section className="dq-window" style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
      {/* 静的サマリー (折り畳み) */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            padding: '0.25em 0',
            color: 'var(--color-fg)',
            font: 'inherit',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5em',
            cursor: 'pointer',
            boxShadow: 'none',
          }}
        >
          <span style={{ fontSize: '0.8em', color: 'var(--color-muted)' }}>今の姿</span>
          <span style={{ fontSize: '1em', fontWeight: 700 }}>{jobName}</span>
          {tagline && (
            <span style={{ fontSize: '0.75em', color: 'var(--color-muted)' }}>{tagline}</span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--color-muted)' }}>{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <div style={{ marginTop: '0.5em', display: 'flex', alignItems: 'center', gap: '0.8em' }}>
            <RadarChart stats={diag.rpgStats} size={120} normalize showValues={false} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: '0.75em', color: 'var(--color-muted)' }}>
                いま目立っている軸がどこか、形で見る図。絶対値は自分のページで確認できます。
              </p>
              <Link to="/me" style={{ marginTop: '0.4em', display: 'inline-block', fontSize: '0.9em' }}>詳しく見る</Link>
            </div>
          </div>
        )}
      </div>

      {/* 動的: 今日のクエスト。折り畳み時は 1 件、展開時は全件。 */}
      {!targetStats ? (
        <div style={{ fontSize: '0.85em' }}>
          <p style={{ margin: '0 0 0.3em' }}>
            <Link to="/settings">目指す姿</Link> を選ぶと、そこへ近づくための今日のクエストが出ます。
          </p>
        </div>
      ) : quests.length > 0 ? (
        <div>
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>
            今日のクエスト{!open && quests.length > 1 ? ` (他 ${quests.length - 1} 件)` : ''}
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            {(open ? quests : quests.slice(0, 1)).map((q, i) => (
              <li key={q.id}>
                <QuestRow quest={q} showIcon={i === 0} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function QuestRow({ quest, showIcon }: { quest: Quest; showIcon: boolean }) {
  const progress = quest.requiredCount > 0
    ? Math.min(1, quest.currentCount / quest.requiredCount)
    : 0;
  const typeBadge = { growth: '成長', maintenance: '維持', restraint: '節制' }[quest.type];
  const typeColor = {
    growth: 'var(--color-accent)',
    maintenance: 'var(--color-muted)',
    restraint: 'var(--color-agi)',
  }[quest.type];

  return (
    <SpiritBubble showIcon={showIcon} iconSize={36} fontSize="0.9em">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '0.7em',
            padding: '0.1em 0.4em',
            border: `1px solid ${typeColor}`,
            color: typeColor,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.1)',
          }}
        >
          {typeBadge}
        </span>
        <span>{quest.description}</span>
      </div>
      {quest.requiredCount > 0 && (
        <div style={{ marginTop: '0.4em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <div style={{ flex: 1, height: 4, background: 'rgba(28,43,68,0.2)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: typeColor }} />
          </div>
          <span style={{ fontSize: '0.75em', color: '#546580', minWidth: '2.5em', textAlign: 'right' }}>
            {quest.currentCount}/{quest.requiredCount}
          </span>
        </div>
      )}
    </SpiritBubble>
  );
}
