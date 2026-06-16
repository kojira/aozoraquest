import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '@atproto/api';
import type { DiagnosisResult, Quest, StatVector } from '@aozoraquest/core';
import { DEFAULT_QUEST_TEMPLATES, actionLabel, generateDailyQuests, jobDisplayName, jobLevelFromXp, playerLevelFromXp } from '@aozoraquest/core';
import { RadarChart } from './radar-chart';
import { PersonIcon, ScrollIcon } from './icons';
import { SpiritBubble } from './spirit-bubble';
import { useOnPosted } from './compose-modal';
import { ensureTodayQuestLog, loadTodayQuestLog, type ActivityEntry, type QuestLogRecord } from '@/lib/post-processor';
import { formatTime } from '@/lib/format-datetime';

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
  const jobLv = jobLevelFromXp(diag.jobLevel?.xp ?? 0);
  const playerLv = playerLevelFromXp(diag.playerLevel?.xp ?? 0);

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
            gap: '0.4em',
            flexWrap: 'nowrap',
            overflow: 'hidden',
            cursor: 'pointer',
            boxShadow: 'none',
          }}
        >
          {/* 「今の姿」ラベル + ジョブ説明は排除し、アイコン + ジョブ名 + LV を
              1 行 (nowrap) に収める。長いジョブ名はジョブ名側だけ省略する。 */}
          <PersonIcon size={14} style={{ color: 'var(--color-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: '0.95em', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{jobName}</span>
          <span style={{ fontSize: '0.78em', fontFamily: 'ui-monospace, monospace', color: 'var(--color-accent)', whiteSpace: 'nowrap', flexShrink: 0 }}>LV{jobLv}</span>
          <span style={{ fontSize: '0.72em', fontFamily: 'ui-monospace, monospace', color: 'var(--color-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>全体{playerLv}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--color-muted)', flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
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

      {/* 動的: 今日のクエスト。常に全件表示する (折り畳み時はコンパクト 1 行、
          展開時はカード表示)。クエスト内容を隠さないのがオーナー方針。 */}
      {!targetStats ? (
        <div style={{ fontSize: '0.85em' }}>
          <p style={{ margin: '0 0 0.3em' }}>
            <Link to="/settings">目指す姿</Link> を選ぶと、そこへ近づくための今日のクエストが出ます。
          </p>
        </div>
      ) : quests.length > 0 ? (() => {
          // 達成済は後ろへ。維持/節制の requiredCount=0 は「今日を過ごしきれば達成」扱いで常に完了表示にはしない。
          const incomplete = quests.filter((q) => !isQuestDone(q));
          const done = quests.filter((q) => isQuestDone(q));
          const visible = [...incomplete, ...done];
          return (
            <div>
              <div style={{ fontSize: '0.8em', color: 'var(--color-muted)', marginBottom: '0.3em', display: 'flex', gap: '0.6em' }}>
                <span>今日のクエスト</span>
                {done.length > 0 && (
                  <span style={{ color: 'var(--color-accent)' }}>達成 {done.length}/{quests.length}</span>
                )}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: open ? '0.35em' : '0.2em' }}>
                {visible.map((q, i) => (
                  <li key={q.id}>
                    <QuestRow quest={q} showIcon={i === 0} compact={!open} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })() : null}

      {/* 透明性: 今日カウントされた行動の監査ログ */}
      {questLog?.activity && questLog.activity.length > 0 && (
        <ActivityAudit activity={questLog.activity} />
      )}
    </section>
  );
}

/** requiredCount に達していれば達成 (requiredCount=0 の維持/節制は達成扱いにしない — 日を跨いだときに評価) */
function isQuestDone(q: Quest): boolean {
  return q.requiredCount > 0 && q.currentCount >= q.requiredCount;
}

function QuestRow({ quest, showIcon, compact = false }: { quest: Quest; showIcon: boolean; compact?: boolean }) {
  const progress = quest.requiredCount > 0
    ? Math.min(1, quest.currentCount / quest.requiredCount)
    : 0;
  const done = isQuestDone(quest);
  const typeBadge = { growth: '成長', maintenance: '維持', restraint: '節制' }[quest.type];
  const typeColor = {
    growth: 'var(--color-accent)',
    maintenance: 'var(--color-muted)',
    restraint: 'var(--color-agi)',
  }[quest.type];

  // 折り畳み (ファーストビュー) 時はスピリット吹き出し + プログレスバーを出さず、
  // 1 行のコンパクト表示にしてホーム上部がクエストに専有されないようにする。
  // 達成済は行全体を薄くせず「達成!」チップを残す (= RPG の達成感をファースト
  // ビューでも消さない)。
  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45em', fontSize: '0.85em' }}>
        <span style={{ fontSize: '0.68em', padding: '0.05em 0.35em', border: `1px solid ${typeColor}`, color: typeColor, borderRadius: 2, background: 'var(--color-overlay-soft)', flexShrink: 0 }}>
          {typeBadge}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...(done ? { color: 'var(--color-muted)', textDecoration: 'line-through' } : {}) }}>
          {quest.description}
        </span>
        {done ? (
          <span style={{ fontSize: '0.68em', padding: '0.05em 0.4em', background: 'var(--color-accent)', color: '#0a1528', borderRadius: 2, fontWeight: 700, flexShrink: 0 }}>
            達成!
          </span>
        ) : quest.requiredCount > 0 ? (
          <span style={{ fontSize: '0.78em', color: 'var(--color-muted)', fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>
            {quest.currentCount}/{quest.requiredCount}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <SpiritBubble showIcon={showIcon} iconSize={36} fontSize="0.9em" {...(done ? { style: { opacity: 0.55 } } : {})}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '0.7em',
            padding: '0.1em 0.4em',
            border: `1px solid ${typeColor}`,
            color: typeColor,
            borderRadius: 2,
            background: 'var(--color-overlay-soft)',
          }}
        >
          {typeBadge}
        </span>
        {done && (
          <span
            style={{
              fontSize: '0.7em',
              padding: '0.1em 0.4em',
              background: 'var(--color-accent)',
              color: '#0a1528',
              borderRadius: 2,
              fontWeight: 700,
            }}
          >
            達成!
          </span>
        )}
        <span style={done ? { textDecoration: 'line-through' } : undefined}>{quest.description}</span>
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

/**
 * 今日の投稿が何と分類され、どのクエストを +1 したかの監査ログ。
 * 「なぜ感謝の返信 3 件が進まないのか」「この投稿はどの行動扱いなのか」を
 * 自分で確認できる透明性 UI。
 *
 * 結果カテゴリ (クエスト達成 / カウント対象外 / 分類不能) ごとに
 * アイコン + 件数のチップへ畳み、チップをタップしたときだけ本文を出す。
 */
type AuditCatKey = 'quest' | 'other' | 'none';

/** entry を結果カテゴリへ振り分ける単一の分類基準 (チップと展開本文でズレないよう一元化)。 */
function auditCategory(e: ActivityEntry): AuditCatKey {
  if (e.incremented.length > 0) return 'quest';
  return e.action ? 'other' : 'none';
}

/** 分類不能 (?) アイコン */
function UnclassifiedIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.3 6.2c0-1 .8-1.7 1.8-1.7s1.7.7 1.7 1.6c0 .8-.5 1.2-1.1 1.6-.5.3-.7.6-.7 1.1v.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
    </svg>
  );
}
/** カウント対象外 (横線) アイコン */
function NoMatchIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden focusable="false">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.8 8H11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ActivityAudit({ activity }: { activity: ActivityEntry[] }) {
  const [openKey, setOpenKey] = useState<AuditCatKey | null>(null);
  // 新しい順 (activity は古い順に追記)
  const sorted = useMemo(() => [...activity].reverse(), [activity]);

  // 結果カテゴリに振り分け (本文は出さず、アイコン+件数だけ畳む)
  const cats = useMemo(() => {
    const defs: { key: AuditCatKey; label: string; accent: boolean; icon: React.ReactNode }[] = [
      { key: 'quest', label: 'クエスト達成', accent: true, icon: <ScrollIcon size={15} /> },
      { key: 'other', label: 'カウント対象外', accent: false, icon: <NoMatchIcon size={15} /> },
      { key: 'none', label: '分類不能', accent: false, icon: <UnclassifiedIcon size={15} /> },
    ];
    return defs
      .map((d) => ({ ...d, entries: sorted.filter((e) => auditCategory(e) === d.key) }))
      .filter((c) => c.entries.length > 0);
  }, [sorted]);

  // 開いていたカテゴリが再集計 (投稿後の再 fetch 等) で 0 件化したら閉じる (ゴースト state 防止)
  useEffect(() => {
    if (openKey && !cats.some((c) => c.key === openKey)) setOpenKey(null);
  }, [cats, openKey]);

  if (sorted.length === 0) return null;

  const openCat = cats.find((c) => c.key === openKey) ?? null;
  const panelId = 'activity-audit-panel';

  return (
    <div style={{ borderTop: '1px solid var(--color-subpanel-border)', paddingTop: '0.5em' }}>
      <div style={{ fontSize: '0.78em', color: 'var(--color-muted)', marginBottom: '0.35em' }}>
        今日カウントされた行動 ({sorted.length})
      </div>
      {/* 分類ごとにアイコン + 件数。押すまで本文は 1 行も出さない */}
      <div style={{ display: 'flex', gap: '0.45em', flexWrap: 'wrap' }}>
        {cats.map((c) => {
          const active = openKey === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setOpenKey(active ? null : c.key)}
              aria-expanded={active}
              aria-controls={active ? panelId : undefined}
              aria-label={`${c.label} ${c.entries.length}件`}
              title={`${c.label} ${c.entries.length}件`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3em',
                minHeight: '1.9em',
                padding: '0.3em 0.7em',
                fontSize: '0.82em',
                borderRadius: 999,
                background: active ? 'var(--color-item-selected-bg)' : 'var(--color-subpanel-bg)',
                border: '1px solid',
                borderColor: active ? 'var(--color-primary)' : 'var(--color-subpanel-border)',
                color: c.accent ? 'var(--color-accent)' : 'var(--color-muted)',
                boxShadow: 'none',
              }}
            >
              {c.icon}
              <span style={{ fontWeight: 700 }}>{c.entries.length}</span>
            </button>
          );
        })}
      </div>
      {openCat && (
        <div id={panelId} style={{ marginTop: '0.45em' }}>
          {/* タップ時のみ、どの分類を開いているかをラベルで明示 (普段はアイコンのみ) */}
          <div style={{ fontSize: '0.78em', fontWeight: 700, marginBottom: '0.3em', color: openCat.accent ? 'var(--color-accent)' : 'var(--color-muted)' }}>
            {openCat.label} ({openCat.entries.length})
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.3em' }}>
            {openCat.entries.map((e) => (
              <li key={e.at}>
                <ActivityRow entry={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const templateToDesc = (id: string): string => {
    const t = DEFAULT_QUEST_TEMPLATES.find((t) => t.id === id);
    return t ? t.descriptionTemplate.replace('{N}', '—') : id;
  };
  const time = formatTime(entry.at);
  const actionText = actionLabel(entry.action);
  return (
    <div
      style={{
        background: 'var(--color-subpanel-bg)',
        border: '1px solid var(--color-subpanel-border)',
        borderRadius: 4,
        padding: '0.4em 0.5em',
        fontSize: '0.8em',
        lineHeight: 1.4,
      }}
    >
      <div style={{ display: 'flex', gap: '0.5em', color: 'var(--color-muted)', fontSize: '0.9em' }}>
        <span>{time}</span>
        <span>→</span>
        <span style={{ color: entry.action ? 'var(--color-accent)' : 'var(--color-muted)' }}>
          {actionText}
        </span>
      </div>
      <div style={{ marginTop: '0.2em', color: 'var(--color-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        「{entry.preview}」
      </div>
      {entry.incremented.length > 0 ? (
        <div style={{ marginTop: '0.3em', color: 'var(--color-muted)', fontSize: '0.85em' }}>
          +1: {entry.incremented.map((id) => templateToDesc(id)).join(' / ')}
        </div>
      ) : (
        <div style={{ marginTop: '0.3em', color: 'var(--color-muted)', fontSize: '0.85em' }}>
          {entry.action ? '該当クエスト無し (カウント対象外)' : '分類できず'}
        </div>
      )}
    </div>
  );
}
