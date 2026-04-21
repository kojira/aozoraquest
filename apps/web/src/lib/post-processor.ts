/**
 * 投稿直後の解析パイプライン。
 *
 * 1. 本文を Ruri-v3 で 1 回だけ埋め込む
 * 2. 行動プロトタイプと比較 → 行動タイプ
 * 3. 認知プロトタイプと比較 → 8 認知機能の per-post 正規化スコア
 * 4. 今日の questLog を読み込み / 新規、該当 growth / maintenance の currentCount を +1、
 *    restraint の forbiddenActionTypes 該当なら failed マーク
 * 5. analysis を更新:
 *    - cognitiveScores を α=0.97 でブレンド (新しい投稿が少しずつ寄せる)
 *    - rpgStats に ACTION_WEIGHTS を加算して合計 100 に正規化
 *    - archetype を新 cognitiveScores から再判定
 * 6. 更新結果を呼び出し元に返す
 */

import type { Agent } from '@atproto/api';
import type { ActionType, CogFunction, CognitiveScores, DiagnosisResult, JobLevelState, PlayerLevelState, Quest, QuestTemplate, StatVector } from '@aozoraquest/core';
import { DEFAULT_QUEST_TEMPLATES, JOB_XP_REWARDS, cognitiveToRpg, jobLevelFromXp, playerLevelFromXp } from '@aozoraquest/core';
import { classifyFromVec, type ActionCategory } from './action-classifier';
import { classifyCognitiveFromVec } from './cognitive-classifier';
import { getEmbedder } from './embedder';
import { getRecord, putRecord } from './atproto';

export interface QuestLogEntry {
  id: string;
  templateId: string;
  type: 'growth' | 'maintenance' | 'restraint';
  targetStat: 'atk' | 'def' | 'agi' | 'int' | 'luk';
  requiredCount: number;
  currentCount: number;
  completed: boolean;
  xpAwarded?: number;
}

/** 投稿 1 件の分類履歴 (透明性表示用: なぜクエストが進んだかを後から見るため) */
export interface ActivityEntry {
  /** 発生時刻 (ISO) */
  at: string;
  /** 投稿本文の先頭 (最大 60 字)。プライバシー配慮で全文は記録しない。 */
  preview: string;
  /** 分類された行動タイプ。分類不能なら null。 */
  action: string | null;
  /** この投稿で +1 された quest の templateId 一覧。 */
  incremented: string[];
}

export interface QuestLogRecord {
  date: string;
  quests: QuestLogEntry[];
  /** 今日分類された投稿の履歴 (古い順)。最新 50 件までを保持。 */
  activity?: ActivityEntry[];
  totalXpGained?: number;
  updatedAt: string;
}

export interface ProcessResult {
  action: ActionCategory | null;
  incremented: string[];
  completed: string[];
  xpGained: number;
  updatedRpgStats?: StatVector | undefined;
  updatedCognitive?: CognitiveScores | undefined;
  jobLevel?: JobLevelState | undefined;
  playerLevel?: PlayerLevelState | undefined;
  jobLeveledUp?: { from: number; to: number } | undefined;
  playerLeveledUp?: { from: number; to: number } | undefined;
}

/** 認知機能スコアのブレンド比率。α * 既存 + (1-α) * 新規。 */
const COGNITIVE_BLEND_ALPHA = 0.97;

const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function templateById(id: string): QuestTemplate | undefined {
  return DEFAULT_QUEST_TEMPLATES.find((t) => t.id === id);
}

export async function processSelfPost(
  agent: Agent,
  did: string,
  text: string,
): Promise<ProcessResult> {
  const trimmed = text.trim();
  const empty: ProcessResult = { action: null, incremented: [], completed: [], xpGained: 0 };
  if (trimmed.length === 0) return empty;

  // 1) 埋め込みは 1 回
  const embedder = getEmbedder();
  await embedder.init().catch(() => { /* 既に init 済みなら no-op */ });
  const vec = await embedder.embed(trimmed);

  // 2) 行動 & 認知を並列 (どちらもベクトルから同期的に計算)
  const [actResult, postCognitive] = await Promise.all([
    classifyFromVec(vec),
    classifyCognitiveFromVec(vec, embedder),
  ]);

  const action = actResult.action;
  const actionType = action ? (action as ActionType) : null;

  // 3) questLog の更新 (常に記録: 分類されなかった投稿も activity に残すことで「なぜ進まないか」が分かる)
  const incremented: string[] = [];
  const completed: string[] = [];
  let xpGained = 0;
  {
    const date = todayDateString();
    const existing = await getRecord<QuestLogRecord>(agent, did, 'app.aozoraquest.questLog', date);
    const log: QuestLogRecord = existing ?? {
      date,
      quests: [],
      activity: [],
      totalXpGained: 0,
      updatedAt: new Date().toISOString(),
    };
    if (actionType) {
      for (const q of log.quests) {
        if (q.completed) continue;
        const tmpl = templateById(q.templateId);
        if (!tmpl) continue;
        if (tmpl.type === 'restraint') {
          if (tmpl.forbiddenActionTypes?.includes(actionType)) {
            q.completed = false;
            q.xpAwarded = 0;
          }
          continue;
        }
        if (tmpl.expectedActionTypes?.includes(actionType)) {
          q.currentCount = q.currentCount + 1;
          incremented.push(q.templateId);
          if (q.currentCount >= q.requiredCount && q.requiredCount > 0) {
            q.completed = true;
            const xp = tmpl.xpRewardFn(q.currentCount);
            q.xpAwarded = xp;
            completed.push(q.templateId);
            xpGained += xp;
          }
        }
      }
    }
    const preview = trimmed.length > 60 ? trimmed.slice(0, 60) + '…' : trimmed;
    const entry: ActivityEntry = {
      at: new Date().toISOString(),
      preview,
      action: actionType,
      incremented,
    };
    const prev = log.activity ?? [];
    log.activity = [...prev, entry].slice(-50);
    log.totalXpGained = (log.totalXpGained ?? 0) + xpGained;
    log.updatedAt = new Date().toISOString();
    await putRecord(agent, 'app.aozoraquest.questLog', date, log);
  }

  // 4) analysis を更新
  //   - cognitiveScores を α でブレンド (新しい投稿が少しずつ寄せる)
  //   - rpgStats は常に cognitiveScores から合成
  //   - ※ archetype は post ごとに自動更新しない (勝手な転職を防ぐ)。
  //     re-diagnosis (明示的な「もう一度調べる」) でのみ更新される。
  //   - playerLevel.xp は常に積む。jobLevel.xp は現 archetype のみ積む。
  //   - 日次ボーナス / streak は playerLevel で判定 (1 日 1 回の本体)。
  let updatedRpgStats: StatVector | undefined;
  let updatedCognitive: CognitiveScores | undefined;
  let finalJobLevel: JobLevelState | undefined;
  let finalPlayerLevel: PlayerLevelState | undefined;
  let jobLeveledUp: { from: number; to: number } | undefined;
  let playerLeveledUp: { from: number; to: number } | undefined;
  try {
    const analysis = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self');
    if (analysis?.cognitiveScores) {
      const blended = blendCognitive(analysis.cognitiveScores, postCognitive, COGNITIVE_BLEND_ALPHA);
      updatedCognitive = blended;

      const nextStats = cognitiveToRpg(blended);
      updatedRpgStats = nextStats;

      // ── XP 計算 ─────────────────────────────
      const now = new Date();
      const nowIso = now.toISOString();
      const today = todayDateString();
      const oldPlayer: PlayerLevelState = analysis.playerLevel ?? { xp: 0, streakDays: 0 };
      const oldJob: JobLevelState = analysis.jobLevel ?? {
        archetype: analysis.archetype,
        xp: 0,
        joinedAt: analysis.analyzedAt,
      };

      let gainedXp = 0;
      if (actionType) gainedXp += JOB_XP_REWARDS.postMatch;
      gainedXp += xpGained; // クエスト完了分

      // 日次ボーナス (playerLevel で判定、1 日 1 回)
      const prevBonusDate = oldPlayer.lastDailyBonusDate;
      let newStreak = oldPlayer.streakDays;
      let newBonusDate = prevBonusDate;
      if (prevBonusDate !== today) {
        newStreak = prevBonusDate && isYesterday(prevBonusDate, today) ? newStreak + 1 : 1;
        const streakBonus = Math.min(JOB_XP_REWARDS.streakBonusCap, newStreak * JOB_XP_REWARDS.streakBonusPerDay);
        gainedXp += JOB_XP_REWARDS.dailyBonus + streakBonus;
        newBonusDate = today;
      }

      // playerLevel 更新 (常に積む)
      const prevPlayerLv = playerLevelFromXp(oldPlayer.xp);
      const nextPlayerXp = oldPlayer.xp + gainedXp;
      const nextPlayerLv = playerLevelFromXp(nextPlayerXp);
      if (nextPlayerLv > prevPlayerLv) playerLeveledUp = { from: prevPlayerLv, to: nextPlayerLv };
      const nextPlayerLevel: PlayerLevelState = {
        xp: nextPlayerXp,
        ...(newBonusDate ? { lastDailyBonusDate: newBonusDate } : {}),
        streakDays: newStreak,
      };
      finalPlayerLevel = nextPlayerLevel;

      // jobLevel 更新 (現 archetype の分のみ。archetype は post では変えない)
      const prevJobLv = jobLevelFromXp(oldJob.xp);
      const nextJobXp = oldJob.xp + gainedXp;
      const nextJobLv = jobLevelFromXp(nextJobXp);
      if (nextJobLv > prevJobLv) jobLeveledUp = { from: prevJobLv, to: nextJobLv };
      const nextJobLevel: JobLevelState = {
        archetype: oldJob.archetype,
        xp: nextJobXp,
        joinedAt: oldJob.joinedAt,
      };
      finalJobLevel = nextJobLevel;

      await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
        ...analysis,
        cognitiveScores: blended,
        rpgStats: nextStats,
        // archetype は固定 (post ごとには変えない)
        analyzedAt: analysis.analyzedAt,
        jobLevel: nextJobLevel,
        playerLevel: nextPlayerLevel,
      });
      void nowIso; // 将来 jobLevel.joinedAt 更新などに使う用
    }
  } catch (e) {
    console.warn('analysis update failed', e);
  }

  return {
    action,
    incremented,
    completed,
    xpGained,
    updatedRpgStats,
    updatedCognitive,
    jobLevel: finalJobLevel,
    playerLevel: finalPlayerLevel,
    jobLeveledUp,
    playerLeveledUp,
  };
}

/** dateA (YYYY-MM-DD) が dateB の前日かどうか。 */
function isYesterday(dateA: string, dateB: string): boolean {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  const diff = b.getTime() - a.getTime();
  return diff > 0 && diff <= 1000 * 60 * 60 * 24 * 1.5;
}

function blendCognitive(
  existing: CognitiveScores,
  post: CognitiveScores,
  alpha: number,
): CognitiveScores {
  const out = {} as CognitiveScores;
  for (const fn of COGNITIVE_FUNCTIONS) {
    const e = existing[fn] ?? 0;
    const p = post[fn] ?? 0;
    out[fn] = Math.round(alpha * e + (1 - alpha) * p);
  }
  return out;
}

/** HomeSummary が生成したクエストを questLog レコードに初期化する。 */
export async function ensureTodayQuestLog(
  agent: Agent,
  did: string,
  quests: Quest[],
): Promise<QuestLogRecord> {
  const date = todayDateString();
  const existing = await getRecord<QuestLogRecord>(agent, did, 'app.aozoraquest.questLog', date);
  if (existing) return existing;
  const record: QuestLogRecord = {
    date,
    quests: quests.map<QuestLogEntry>((q) => ({
      id: q.id,
      templateId: q.templateId,
      type: q.type,
      targetStat: q.targetStat,
      requiredCount: q.requiredCount,
      currentCount: q.currentCount,
      completed: false,
    })),
    totalXpGained: 0,
    updatedAt: new Date().toISOString(),
  };
  await putRecord(agent, 'app.aozoraquest.questLog', date, record);
  return record;
}

export async function loadTodayQuestLog(
  agent: Agent,
  did: string,
): Promise<QuestLogRecord | null> {
  const date = todayDateString();
  return getRecord<QuestLogRecord>(agent, did, 'app.aozoraquest.questLog', date);
}
