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
import type { ActionType, CogFunction, CognitiveScores, DiagnosisResult, Quest, QuestTemplate, StatVector } from '@aozoraquest/core';
import { ACTION_WEIGHTS, DEFAULT_QUEST_TEMPLATES, determineArchetype } from '@aozoraquest/core';
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

export interface QuestLogRecord {
  date: string;
  quests: QuestLogEntry[];
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

  // 3) questLog の更新 (action があるときのみ)
  const incremented: string[] = [];
  const completed: string[] = [];
  let xpGained = 0;
  if (actionType) {
    const date = todayDateString();
    const existing = await getRecord<QuestLogRecord>(agent, did, 'app.aozoraquest.questLog', date);
    const log: QuestLogRecord = existing ?? {
      date,
      quests: [],
      totalXpGained: 0,
      updatedAt: new Date().toISOString(),
    };
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
    log.totalXpGained = (log.totalXpGained ?? 0) + xpGained;
    log.updatedAt = new Date().toISOString();
    await putRecord(agent, 'app.aozoraquest.questLog', date, log);
  }

  // 4) analysis を更新 (cognitive blend + rpgStats + archetype)
  let updatedRpgStats: StatVector | undefined;
  let updatedCognitive: CognitiveScores | undefined;
  try {
    const analysis = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self');
    if (analysis?.cognitiveScores) {
      // 認知ブレンド
      const blended = blendCognitive(analysis.cognitiveScores, postCognitive, COGNITIVE_BLEND_ALPHA);
      updatedCognitive = blended;

      // rpgStats: 既存 rpgStats に ACTION_WEIGHTS 加算 → 正規化
      let nextStats = analysis.rpgStats;
      if (actionType) {
        const w = ACTION_WEIGHTS[actionType];
        const raw: StatVector = {
          atk: Math.max(0, (analysis.rpgStats?.atk ?? 0) + w.atk),
          def: Math.max(0, (analysis.rpgStats?.def ?? 0) + w.def),
          agi: Math.max(0, (analysis.rpgStats?.agi ?? 0) + w.agi),
          int: Math.max(0, (analysis.rpgStats?.int ?? 0) + w.int),
          luk: Math.max(0, (analysis.rpgStats?.luk ?? 0) + w.luk),
        };
        nextStats = normalizeTo100(raw);
        updatedRpgStats = nextStats;
      }

      // archetype 再判定
      const { archetype: newArchetype } = determineArchetype(blended);
      const archetype = newArchetype ?? analysis.archetype;

      await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
        ...analysis,
        cognitiveScores: blended,
        rpgStats: nextStats,
        archetype,
        analyzedAt: analysis.analyzedAt,
      });
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
  };
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

function normalizeTo100(s: StatVector): StatVector {
  const sum = s.atk + s.def + s.agi + s.int + s.luk;
  if (sum === 0) return { atk: 20, def: 20, agi: 20, int: 20, luk: 20 };
  const k = 100 / sum;
  const raw = {
    atk: s.atk * k, def: s.def * k, agi: s.agi * k, int: s.int * k, luk: s.luk * k,
  };
  const rounded = {
    atk: Math.round(raw.atk),
    def: Math.round(raw.def),
    agi: Math.round(raw.agi),
    int: Math.round(raw.int),
    luk: Math.round(raw.luk),
  };
  const rSum = rounded.atk + rounded.def + rounded.agi + rounded.int + rounded.luk;
  const diff = 100 - rSum;
  if (diff !== 0) {
    const order: Array<keyof StatVector> = ['atk', 'def', 'agi', 'int', 'luk'];
    order.sort((a, b) => rounded[b] - rounded[a]);
    const target = order[0]!;
    rounded[target] = rounded[target] + diff;
  }
  return rounded;
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
