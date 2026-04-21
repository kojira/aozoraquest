/**
 * 投稿直後の解析パイプライン。
 *
 * 1. 本文を Ruri-v3 で埋め込み、行動プロトタイプと比較して行動タイプを分類
 * 2. 今日の questLog を読み込み (無ければ新規)、該当する growth/maintenance クエストの currentCount を +1、
 *    restraint クエストの forbiddenActionTypes に該当する場合は completed=false をキープ (失敗)
 * 3. クエスト達成したら completed=true + xpAwarded を設定、totalXpGained に加算
 * 4. analysis.rpgStats を ACTION_WEIGHTS で増減、合計 100 に正規化して保存
 * 5. 更新結果を呼び出し元に返す
 */

import type { Agent } from '@atproto/api';
import type { ActionType, DiagnosisResult, Quest, QuestTemplate, StatVector } from '@aozoraquest/core';
import { ACTION_WEIGHTS, DEFAULT_QUEST_TEMPLATES } from '@aozoraquest/core';
import { classifyPost, type ActionCategory } from './action-classifier';
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
  date: string; // ISO datetime (date 部分のみ使用)
  quests: QuestLogEntry[];
  totalXpGained?: number;
  updatedAt: string;
}

export interface ProcessResult {
  action: ActionCategory | null;
  incremented: string[];     // 進んだクエストの templateId
  completed: string[];       // 今回達成したクエストの templateId
  xpGained: number;
  updatedRpgStats?: StatVector | undefined;
}

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function templateById(id: string): QuestTemplate | undefined {
  return DEFAULT_QUEST_TEMPLATES.find((t) => t.id === id);
}

/**
 * 自分の投稿 1 件が発生した直後に呼ぶ。
 *
 * @param agent ログイン済み agent
 * @param did   自分の DID
 * @param text  投稿本文
 * @returns     分類結果と更新内容。UI に反映する用。
 */
export async function processSelfPost(
  agent: Agent,
  did: string,
  text: string,
): Promise<ProcessResult> {
  const trimmed = text.trim();
  const empty: ProcessResult = { action: null, incremented: [], completed: [], xpGained: 0 };
  if (trimmed.length === 0) return empty;

  // 1) 分類
  const embedder = getEmbedder();
  await embedder.init().catch(() => { /* 既に init 済みなら no-op */ });
  const { action } = await classifyPost(embedder, trimmed);
  if (!action) return empty;

  // ActionCategory は ActionType の subset なので as 変換可
  const actionType = action as ActionType;

  // 2) 今日の questLog を取得
  const date = todayDateString();
  const rkey = date; // YYYY-MM-DD
  const existing = await getRecord<QuestLogRecord>(agent, did, 'app.aozoraquest.questLog', rkey);

  // 無ければ今日のクエストを生成して questLog を新規作成
  let log: QuestLogRecord;
  if (existing) {
    log = existing;
  } else {
    // 空の quests: HomeSummary が generateDailyQuests で作る 3 件と揃えたいが、
    // このサーバーサイド側でも generate して入れておく。initial は全部 currentCount=0。
    // ここでは簡易に「まだ questLog 無し」の場合は空で始める。HomeSummary の方が正とする。
    log = {
      date,
      quests: [],
      totalXpGained: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  // 3) quest を更新
  const incremented: string[] = [];
  const completed: string[] = [];
  let xpGained = 0;
  for (const q of log.quests) {
    if (q.completed) continue;
    const tmpl = templateById(q.templateId);
    if (!tmpl) continue;

    if (tmpl.type === 'restraint') {
      if (tmpl.forbiddenActionTypes?.includes(actionType)) {
        // 失敗: completed は変えない (0 XP のまま), ただマークだけ
        q.completed = false;
        q.xpAwarded = 0;
      }
      continue;
    }
    // growth / maintenance
    if (tmpl.expectedActionTypes?.includes(actionType)) {
      q.currentCount = q.currentCount + 1;
      incremented.push(q.templateId);
      if (q.currentCount >= q.requiredCount && q.requiredCount > 0) {
        q.completed = true;
        const xp = tmpl.xpRewardFn(q.currentCount);
        q.xpAwarded = xp;
        completed.push(q.templateId);
        xpGained += xp;
      } else if (q.requiredCount === 0) {
        // maintenance_read_silent のような requiredCount=0 のクエストは達成判定しない
      }
    }
  }
  log.totalXpGained = (log.totalXpGained ?? 0) + xpGained;
  log.updatedAt = new Date().toISOString();

  await putRecord(agent, 'app.aozoraquest.questLog', rkey, log);

  // 4) rpgStats を更新 (analysis にすでに値がある場合のみ)
  let updatedRpgStats: StatVector | undefined;
  try {
    const analysis = await getRecord<DiagnosisResult>(agent, did, 'app.aozoraquest.analysis', 'self');
    if (analysis?.rpgStats) {
      const w = ACTION_WEIGHTS[actionType];
      const next: StatVector = {
        atk: Math.max(0, (analysis.rpgStats.atk ?? 0) + w.atk),
        def: Math.max(0, (analysis.rpgStats.def ?? 0) + w.def),
        agi: Math.max(0, (analysis.rpgStats.agi ?? 0) + w.agi),
        int: Math.max(0, (analysis.rpgStats.int ?? 0) + w.int),
        luk: Math.max(0, (analysis.rpgStats.luk ?? 0) + w.luk),
      };
      const normalized = normalizeTo100(next);
      updatedRpgStats = normalized;
      await putRecord(agent, 'app.aozoraquest.analysis', 'self', {
        ...analysis,
        rpgStats: normalized,
        analyzedAt: analysis.analyzedAt,
      });
    }
  } catch (e) {
    console.warn('rpgStats update failed', e);
  }

  return { action, incremented, completed, xpGained, updatedRpgStats };
}

function normalizeTo100(s: StatVector): StatVector {
  const sum = s.atk + s.def + s.agi + s.int + s.luk;
  if (sum === 0) return { atk: 20, def: 20, agi: 20, int: 20, luk: 20 };
  const k = 100 / sum;
  const raw = {
    atk: s.atk * k,
    def: s.def * k,
    agi: s.agi * k,
    int: s.int * k,
    luk: s.luk * k,
  };
  // 四捨五入して合計 100 になるよう誤差を調整
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
    // 絶対値の大きい軸に吸収させる
    const order: Array<keyof StatVector> = ['atk', 'def', 'agi', 'int', 'luk'];
    order.sort((a, b) => rounded[b] - rounded[a]);
    const target = order[0]!;
    rounded[target] = rounded[target] + diff;
  }
  return rounded;
}

/**
 * HomeSummary が生成したクエストを questLog レコードに初期化する。
 * 1 日の初回アクセスで呼ぶと、サーバー側で進捗を累積できる。
 */
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
