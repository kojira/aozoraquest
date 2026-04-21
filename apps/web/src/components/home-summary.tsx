import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { DiagnosisResult, Quest, StatVector } from '@aozoraquest/core';
import { generateDailyQuests, jobDisplayName } from '@aozoraquest/core';
import { RadarChart } from './radar-chart';

interface HomeSummaryProps {
  diag: DiagnosisResult | null;
  userDid: string;
}

/** 仮の目標値: 全軸バランス (20/20/20/20/20)。将来は user.profile.targetJob から引く。 */
const BALANCED_TARGET: StatVector = { atk: 20, def: 20, agi: 20, int: 20, luk: 20 };

export function HomeSummary({ diag, userDid }: HomeSummaryProps) {
  const quests: Quest[] = useMemo(() => {
    if (!diag) return [];
    const today = new Date();
    const dateStr =
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return generateDailyQuests({
      userDid,
      dateStr,
      level: 1, // TODO: xp log から算出する
      currentStats: diag.rpgStats,
      targetStats: BALANCED_TARGET,
      recentTemplateIds: [],
    });
  }, [diag, userDid]);

  if (!diag) {
    return (
      <section className="dq-window">
        <p style={{ margin: 0 }}>
          まだあなたの気質を調べていません。
          <Link to="/me" style={{ marginLeft: '0.4em' }}>自分のページ</Link> から調べると、
          ここに姿・ステータス・今日のクエストが表示されます。
        </p>
      </section>
    );
  }

  return (
    <section className="dq-window" style={{ display: 'flex', flexDirection: 'column', gap: '0.8em' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1em', flexWrap: 'wrap' }}>
        <RadarChart stats={diag.rpgStats} size={200} />
        <div style={{ flex: 1, minWidth: '10em' }}>
          <div style={{ fontSize: '0.85em', color: 'var(--color-muted)' }}>今の姿</div>
          <div style={{ fontSize: '1.3em', fontWeight: 700 }}>{jobDisplayName(diag.archetype, 'default')}</div>
          <div style={{ fontSize: '0.75em', color: 'var(--color-muted)', marginTop: '0.3em' }}>
            {diag.analyzedPostCount} 件の投稿から
          </div>
          <div style={{ marginTop: '0.5em' }}>
            <Link to="/me" style={{ fontSize: '0.85em' }}>詳しく見る</Link>
          </div>
        </div>
      </div>

      <div>
        <h3 style={{ fontSize: '0.95em', margin: '0 0 0.4em' }}>今日のクエスト</h3>
        {quests.length === 0 ? (
          <p style={{ fontSize: '0.85em', color: 'var(--color-muted)', margin: 0 }}>
            特に提案できる課題がない日です。気分で投稿してください。
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4em' }}>
            {quests.map((q) => (
              <QuestRow key={q.id} quest={q} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function QuestRow({ quest }: { quest: Quest }) {
  const progress = quest.requiredCount > 0
    ? Math.min(1, quest.currentCount / quest.requiredCount)
    : 0;
  const typeBadge = {
    growth: '成長',
    maintenance: '維持',
    restraint: '節制',
  }[quest.type];
  const typeColor = {
    growth: 'var(--color-accent)',
    maintenance: 'var(--color-muted)',
    restraint: 'var(--color-agi)',
  }[quest.type];

  return (
    <li
      style={{
        padding: '0.5em 0.7em',
        background: 'rgba(255, 255, 255, 0.06)',
        borderRadius: 3,
        border: '1px solid rgba(255, 255, 255, 0.15)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
        <span
          style={{
            fontSize: '0.7em',
            padding: '0.1em 0.4em',
            border: `1px solid ${typeColor}`,
            color: typeColor,
            borderRadius: 2,
          }}
        >
          {typeBadge}
        </span>
        <span style={{ fontSize: '0.9em' }}>{quest.description}</span>
      </div>
      {quest.requiredCount > 0 && (
        <div style={{ marginTop: '0.35em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <div style={{ flex: 1, height: 4, background: 'rgba(255, 255, 255, 0.15)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progress * 100}%`,
                height: '100%',
                background: typeColor,
                transition: 'width 0.2s',
              }}
            />
          </div>
          <span style={{ fontSize: '0.7em', color: 'var(--color-muted)', minWidth: '2.5em', textAlign: 'right' }}>
            {quest.currentCount}/{quest.requiredCount}
          </span>
        </div>
      )}
      <div style={{ fontSize: '0.7em', color: 'var(--color-muted)', marginTop: '0.2em' }}>
        +{quest.xpReward} XP
      </div>
    </li>
  );
}
