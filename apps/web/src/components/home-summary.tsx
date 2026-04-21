import { useMemo, useState } from 'react';
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
export function HomeSummary({ diag, userDid }: HomeSummaryProps) {
  const [open, setOpen] = useState(false);

  const quests: Quest[] = useMemo(() => {
    if (!diag) return [];
    const today = new Date();
    const dateStr =
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return generateDailyQuests({
      userDid,
      dateStr,
      level: 1, // TODO: xp log から算出
      currentStats: diag.rpgStats,
      targetStats: BALANCED_TARGET,
      recentTemplateIds: [],
    });
  }, [diag, userDid]);

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
          <span style={{ marginLeft: 'auto', color: 'var(--color-muted)' }}>{open ? '▾' : '▸'}</span>
        </button>

        {open && (
          <div style={{ marginTop: '0.5em', display: 'flex', alignItems: 'center', gap: '0.8em' }}>
            <RadarChart stats={diag.rpgStats} size={100} />
            <div style={{ fontSize: '0.8em', display: 'flex', flexWrap: 'wrap', gap: '0.3em 0.8em', flex: 1 }}>
              <StatInline label="攻" v={diag.rpgStats.atk} />
              <StatInline label="守" v={diag.rpgStats.def} />
              <StatInline label="速" v={diag.rpgStats.agi} />
              <StatInline label="知" v={diag.rpgStats.int} />
              <StatInline label="運" v={diag.rpgStats.luk} />
              <Link to="/me" style={{ marginLeft: 'auto', fontSize: '0.9em' }}>詳しく</Link>
            </div>
          </div>
        )}
      </div>

      {/* 動的: 今日のクエスト (常時表示) */}
      {quests.length > 0 && (
        <div>
          <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em' }}>今日のクエスト</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35em' }}>
            {quests.map((q) => (
              <QuestRow key={q.id} quest={q} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatInline({ label, v }: { label: string; v: number }) {
  return (
    <span style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>
      {label} {v}
    </span>
  );
}

function QuestRow({ quest }: { quest: Quest }) {
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
    <li
      style={{
        padding: '0.4em 0.6em',
        background: 'rgba(255, 255, 255, 0.05)',
        borderRadius: 3,
        border: '1px solid rgba(255, 255, 255, 0.12)',
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
        <span style={{ fontSize: '0.85em' }}>{quest.description}</span>
      </div>
      {quest.requiredCount > 0 && (
        <div style={{ marginTop: '0.3em', display: 'flex', alignItems: 'center', gap: '0.5em' }}>
          <div style={{ flex: 1, height: 3, background: 'rgba(255, 255, 255, 0.15)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: typeColor }} />
          </div>
          <span style={{ fontSize: '0.7em', color: 'var(--color-muted)', minWidth: '2.5em', textAlign: 'right' }}>
            {quest.currentCount}/{quest.requiredCount}
          </span>
        </div>
      )}
    </li>
  );
}
