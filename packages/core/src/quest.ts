import { statGap, sortStatsByAbsGap } from './stats.js';
import { JOB_LEVEL_TUNING, PLAYER_LEVEL_TUNING, XP_REWARDS } from './tuning.js';
import type { ActionType, Quest, Stat, StatVector } from './types.js';

/**
 * クエストテンプレート (03-game-design.md §クエストテンプレートプール)。
 */
export interface QuestTemplate {
  id: string;
  type: 'growth' | 'maintenance' | 'restraint';
  targetStat: Stat;
  descriptionTemplate: string; // {N} を required count で置換
  requiredCountFn: (level: number) => number;
  xpRewardFn: (count: number) => number;
  /** restraint で禁止される行動タイプ。この行動をすると失敗扱い。 */
  forbiddenActionTypes?: ActionType[];
  /** growth / maintenance がカウントの対象とする行動タイプ。これらの行動で currentCount が +1。 */
  expectedActionTypes?: ActionType[];
}

/**
 * クエストテンプレートプール (45 件)。
 * 5 軸 × growth 6 + maintenance 5 + restraint 10。
 *
 * requiredCountFn は LV 補正を緩めに (1 LV ごと +10%)。restraint は 0 回、maintenance は 1 回。
 */
const scaleLv = (base: number) => (lv: number) => Math.max(base, Math.floor(base * (1 + (lv - 1) * 0.1)));

export const DEFAULT_QUEST_TEMPLATES: QuestTemplate[] = [
  // ─── ATK 成長 (6) ───
  { id: 'atk_opinion_post',  type: 'growth', targetStat: 'atk', descriptionTemplate: '自分の意見を {N} 個発信せよ',         requiredCountFn: scaleLv(3), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['opinion_post'] },
  { id: 'atk_debate_reply',  type: 'growth', targetStat: 'atk', descriptionTemplate: '議論に {N} 回参戦せよ',                requiredCountFn: scaleLv(2), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['opinion_post'] },
  { id: 'atk_quote_opinion', type: 'growth', targetStat: 'atk', descriptionTemplate: '誰かの投稿を引用し自分の立場を {N} 回示せ', requiredCountFn: scaleLv(2), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['opinion_post', 'quote_with_opinion'] },
  { id: 'atk_hot_take',      type: 'growth', targetStat: 'atk', descriptionTemplate: '躊躇せず思ったことを {N} 回ポストせよ', requiredCountFn: scaleLv(3), xpRewardFn: n => 55 + n * 10, expectedActionTypes: ['opinion_post', 'short_burst'] },
  { id: 'atk_stance_reply',  type: 'growth', targetStat: 'atk', descriptionTemplate: '異論に {N} 回、丁寧に返答せよ',         requiredCountFn: scaleLv(2), xpRewardFn: n => 65 + n * 12, expectedActionTypes: ['opinion_post'] },
  { id: 'atk_solo_thread',   type: 'growth', targetStat: 'atk', descriptionTemplate: '一つのテーマで連続投稿を {N} 本書け',   requiredCountFn: scaleLv(2), xpRewardFn: n => 70 + n * 15, expectedActionTypes: ['opinion_post', 'analysis_post'] },

  // ─── DEF 成長 (6) ───
  { id: 'def_thread',         type: 'growth', targetStat: 'def', descriptionTemplate: 'スレッドを {N} 段続けよ',              requiredCountFn: () => 3,     xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['analysis_post', 'thread_continue'] },
  { id: 'def_streak',         type: 'growth', targetStat: 'def', descriptionTemplate: '{N} 日連続で投稿せよ',                  requiredCountFn: () => 3,     xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['streak_maintain', 'short_burst', 'analysis_post'] },
  { id: 'def_calm_debate',    type: 'growth', targetStat: 'def', descriptionTemplate: '荒れた会話に落ち着いて返答を {N} 回', requiredCountFn: scaleLv(2), xpRewardFn: n => 65 + n * 13, expectedActionTypes: ['calm_debate_reply', 'analysis_post'] },
  { id: 'def_deep_reply',     type: 'growth', targetStat: 'def', descriptionTemplate: '同じ相手に {N} 往復、会話を深めよ',   requiredCountFn: scaleLv(2), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['analysis_post', 'calm_debate_reply'] },
  { id: 'def_anchored_series',type: 'growth', targetStat: 'def', descriptionTemplate: 'テーマを固定して {N} 日投稿せよ',     requiredCountFn: () => 3,     xpRewardFn: n => 70 + n * 15, expectedActionTypes: ['analysis_post'] },
  { id: 'def_supporter_reply',type: 'growth', targetStat: 'def', descriptionTemplate: '困っている投稿に {N} 件、静かに寄り添え', requiredCountFn: scaleLv(2), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['empathy_reply'] },

  // ─── AGI 成長 (6) ───
  { id: 'agi_short_post',    type: 'growth', targetStat: 'agi', descriptionTemplate: '軽やかに短文を {N} 個連投せよ',        requiredCountFn: scaleLv(3), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['short_burst'] },
  { id: 'agi_quick_reply',   type: 'growth', targetStat: 'agi', descriptionTemplate: '{N} 件のポストに 5 分以内に反応せよ',  requiredCountFn: () => 3,     xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['quick_reply', 'short_burst'] },
  { id: 'agi_rhythm_chain',  type: 'growth', targetStat: 'agi', descriptionTemplate: '30 分以内に {N} 投稿、リズムを保て',   requiredCountFn: scaleLv(3), xpRewardFn: n => 55 + n * 10, expectedActionTypes: ['short_burst'] },
  { id: 'agi_pulse_burst',   type: 'growth', targetStat: 'agi', descriptionTemplate: '今日の瞬間を {N} 回切り取って投稿',   requiredCountFn: scaleLv(3), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['short_burst'] },
  { id: 'agi_skim_reply',    type: 'growth', targetStat: 'agi', descriptionTemplate: 'TL を流し読み、気になった {N} 件に即反応', requiredCountFn: scaleLv(4), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['short_burst', 'quick_reply'] },
  { id: 'agi_fast_repost',   type: 'growth', targetStat: 'agi', descriptionTemplate: '{N} 回、1 分以内にリポスト判断せよ',   requiredCountFn: scaleLv(3), xpRewardFn: n => 45 + n * 10, expectedActionTypes: ['repost_only'] },

  // ─── INT 成長 (6) ───
  { id: 'int_long_post',      type: 'growth', targetStat: 'int', descriptionTemplate: '200 字以上の分析を {N} 件書け',        requiredCountFn: () => 2,     xpRewardFn: n => 70 + n * 15, expectedActionTypes: ['analysis_post'] },
  { id: 'int_quote_analysis', type: 'growth', targetStat: 'int', descriptionTemplate: '引用して考察を添えよ、{N} 回',         requiredCountFn: () => 2,     xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['analysis_post', 'quote_with_analysis'] },
  { id: 'int_long_thread',    type: 'growth', targetStat: 'int', descriptionTemplate: '複数段の分析スレッドを {N} 本書け',    requiredCountFn: () => 1,     xpRewardFn: n => 90 + n * 20, expectedActionTypes: ['analysis_post'] },
  { id: 'int_citation_post',  type: 'growth', targetStat: 'int', descriptionTemplate: '出典付きの投稿を {N} 件書け',           requiredCountFn: () => 2,     xpRewardFn: n => 75 + n * 15, expectedActionTypes: ['analysis_post'] },
  { id: 'int_critical_read',  type: 'growth', targetStat: 'int', descriptionTemplate: '読んだ記事に批判的コメントを {N} 回付けよ', requiredCountFn: scaleLv(2), xpRewardFn: n => 70 + n * 14, expectedActionTypes: ['analysis_post', 'opinion_post'] },
  { id: 'int_research_reply', type: 'growth', targetStat: 'int', descriptionTemplate: '質問に調べた情報を添えて {N} 回返せ',   requiredCountFn: scaleLv(2), xpRewardFn: n => 65 + n * 13, expectedActionTypes: ['analysis_post'] },

  // ─── LUK 成長 (6) ───
  { id: 'luk_empathy',       type: 'growth', targetStat: 'luk', descriptionTemplate: '{N} 人に共感を贈れ',                   requiredCountFn: scaleLv(5), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['empathy_reply'] },
  { id: 'luk_underseen',     type: 'growth', targetStat: 'luk', descriptionTemplate: '埋もれた投稿に {N} いいね',            requiredCountFn: () => 5,     xpRewardFn: n => 60 + n * 10, expectedActionTypes: ['like_underseen'] },
  { id: 'luk_boost_fresh',   type: 'growth', targetStat: 'luk', descriptionTemplate: '投稿数の少ない人を {N} 回リポストせよ', requiredCountFn: scaleLv(3), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['repost_only'] },
  { id: 'luk_warm_welcome',  type: 'growth', targetStat: 'luk', descriptionTemplate: '新しく出会った人に {N} 回声をかけよ',  requiredCountFn: scaleLv(2), xpRewardFn: n => 60 + n * 12, expectedActionTypes: ['empathy_reply'] },
  { id: 'luk_thank_reply',   type: 'growth', targetStat: 'luk', descriptionTemplate: '感謝の返信を {N} 件送れ',               requiredCountFn: scaleLv(3), xpRewardFn: n => 50 + n * 10, expectedActionTypes: ['empathy_reply'] },
  { id: 'luk_humor_post',    type: 'growth', targetStat: 'luk', descriptionTemplate: '空気を和ませる投稿を {N} 件書け',       requiredCountFn: scaleLv(2), xpRewardFn: n => 55 + n * 12, expectedActionTypes: ['humor_post'] },

  // ─── 維持 (5) ───
  { id: 'maintenance_daily_word',   type: 'maintenance', targetStat: 'def', descriptionTemplate: '今日も一言を記せ',                     requiredCountFn: () => 1, xpRewardFn: () => 20, expectedActionTypes: ['short_burst', 'opinion_post', 'analysis_post', 'humor_post', 'empathy_reply'] },
  { id: 'maintenance_one_thought',  type: 'maintenance', targetStat: 'atk', descriptionTemplate: '今日、思ったことを一度だけ書け',       requiredCountFn: () => 1, xpRewardFn: () => 20, expectedActionTypes: ['opinion_post', 'short_burst'] },
  { id: 'maintenance_gentle_scroll',type: 'maintenance', targetStat: 'agi', descriptionTemplate: 'TL を軽く流し、心に触れた投稿に反応せよ', requiredCountFn: () => 1, xpRewardFn: () => 20, expectedActionTypes: ['short_burst', 'empathy_reply'] },
  { id: 'maintenance_read_silent',  type: 'maintenance', targetStat: 'int', descriptionTemplate: '読むだけの時間を作り、考えを言葉にしない日', requiredCountFn: () => 0, xpRewardFn: () => 20 },
  { id: 'maintenance_thanks_round', type: 'maintenance', targetStat: 'luk', descriptionTemplate: '誰か一人に静かに「ありがとう」を送れ',   requiredCountFn: () => 1, xpRewardFn: () => 20, expectedActionTypes: ['empathy_reply'] },

  // ─── 節制 (10) ───
  { id: 'restraint_opinion',        type: 'restraint', targetStat: 'atk', descriptionTemplate: '今日は意見投稿を控えよ',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['opinion_post', 'quote_with_opinion'] },
  { id: 'restraint_hot_take',       type: 'restraint', targetStat: 'atk', descriptionTemplate: '衝動的な発信を一日休め',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['opinion_post'] },
  { id: 'restraint_long_analysis',  type: 'restraint', targetStat: 'int', descriptionTemplate: '今日は長文分析を控えよ',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['analysis_post', 'quote_with_analysis'] },
  { id: 'restraint_quote_analysis', type: 'restraint', targetStat: 'int', descriptionTemplate: '引用考察を一日置いておけ',     requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['quote_with_analysis'] },
  { id: 'restraint_short_burst',    type: 'restraint', targetStat: 'agi', descriptionTemplate: '今日は短文連投を控えよ',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['short_burst'] },
  { id: 'restraint_quick_reply',    type: 'restraint', targetStat: 'agi', descriptionTemplate: '即レスを一日休め、一息置け',   requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['quick_reply'] },
  { id: 'restraint_thread',         type: 'restraint', targetStat: 'def', descriptionTemplate: '連続スレッドは一日休め',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['thread_continue'] },
  { id: 'restraint_streak',         type: 'restraint', targetStat: 'def', descriptionTemplate: '継続にこだわらず、書かない日を作れ', requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['streak_maintain'] },
  { id: 'restraint_empathy',        type: 'restraint', targetStat: 'luk', descriptionTemplate: '共感返信は今日だけ休め',       requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['empathy_reply'] },
  { id: 'restraint_repost',         type: 'restraint', targetStat: 'luk', descriptionTemplate: 'リポストだけの発信を一日控えよ', requiredCountFn: () => 0, xpRewardFn: () => 80, forbiddenActionTypes: ['repost_only'] },
];

/**
 * ハッシュ関数 (シード生成用、FNV-1a 32-bit)。
 * ユーザー DID + 日付 で決定的にクエストを選ぶ。
 */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface QuestGenInput {
  userDid: string;
  dateStr: string; // YYYY-MM-DD
  level: number;
  currentStats: StatVector;
  targetStats: StatVector;
  recentTemplateIds: readonly string[]; // 過去 7 日に出したテンプレID
  templates?: readonly QuestTemplate[]; // 指定なしなら DEFAULT_QUEST_TEMPLATES
}

/**
 * 毎日のクエストを 3 つ生成。
 * - 上位 2 軸のギャップを埋める成長クエスト
 * - 過剰軸の節制クエスト
 */
export function generateDailyQuests(input: QuestGenInput): Quest[] {
  const tmpls = input.templates ?? DEFAULT_QUEST_TEMPLATES;
  const gap = statGap(input.currentStats, input.targetStats);
  const sortedStats = sortStatsByAbsGap(gap);

  const growthStats: Stat[] = [];
  const restraintStat: Stat[] = [];
  for (const s of sortedStats) {
    if (gap[s] > 0 && growthStats.length < 2) growthStats.push(s);
    else if (gap[s] < 0 && restraintStat.length < 1) restraintStat.push(s);
  }

  const seed = hashStr(`${input.userDid}:${input.dateStr}`);
  const recentSet = new Set(input.recentTemplateIds);
  const quests: Quest[] = [];
  let slotIdx = 0;

  const pickFrom = (candidates: QuestTemplate[]): QuestTemplate | null => {
    const filtered = candidates.filter(t => !recentSet.has(t.id));
    const pool = filtered.length > 0 ? filtered : candidates;
    if (pool.length === 0) return null;
    return pool[(seed + slotIdx) % pool.length] ?? null;
  };

  for (const stat of growthStats) {
    const candidates = tmpls.filter(t => t.type === 'growth' && t.targetStat === stat);
    const tmpl = pickFrom(candidates);
    if (tmpl) {
      const count = tmpl.requiredCountFn(input.level);
      quests.push({
        id: `${input.dateStr}-${slotIdx}`,
        templateId: tmpl.id,
        type: tmpl.type,
        targetStat: tmpl.targetStat,
        description: tmpl.descriptionTemplate.replace('{N}', String(count)),
        requiredCount: count,
        currentCount: 0,
        xpReward: tmpl.xpRewardFn(count),
        issuedDate: input.dateStr,
      });
    }
    slotIdx++;
  }

  for (const stat of restraintStat) {
    const candidates = tmpls.filter(t => t.type === 'restraint' && t.targetStat === stat);
    const tmpl = pickFrom(candidates);
    if (tmpl) {
      const q: Quest = {
        id: `${input.dateStr}-${slotIdx}`,
        templateId: tmpl.id,
        type: tmpl.type,
        targetStat: tmpl.targetStat,
        description: tmpl.descriptionTemplate,
        requiredCount: 0,
        currentCount: 0,
        xpReward: tmpl.xpRewardFn(0),
        issuedDate: input.dateStr,
      };
      if (tmpl.forbiddenActionTypes && tmpl.forbiddenActionTypes.length > 0) {
        q.forbiddenActionTypes = tmpl.forbiddenActionTypes as NonNullable<Quest['forbiddenActionTypes']>;
      }
      quests.push(q);
    }
    slotIdx++;
  }

  return quests;
}

/** 累計 XP から LV を計算 (03-game-design.md §XP とレベル)。グローバル用 (現状未使用)。 */
const XP_CURVE: Array<[number, number]> = [
  [1, 0], [2, 100], [5, 800], [10, 3500], [20, 15000], [30, 40000], [50, 150000],
];
export function levelFromXp(xp: number): number {
  let lv = 1;
  for (const [l, threshold] of XP_CURVE) {
    if (xp >= threshold) lv = l;
    else break;
  }
  return lv;
}

/**
 * 現職 (archetype) の滞在 LV 用 XP 曲線。パラメータは tuning.JOB_LEVEL_TUNING。
 * threshold(n) = round(coef * (n - 1)^exp)、LV1 = 0。
 */
export const JOB_XP_CURVE: ReadonlyArray<readonly [level: number, threshold: number]> = buildXpCurve(
  JOB_LEVEL_TUNING.maxLevel,
  JOB_LEVEL_TUNING.coefficient,
  JOB_LEVEL_TUNING.exponent,
);

/** 累計 XP から現職 LV を計算。 */
export function jobLevelFromXp(xp: number): number {
  let lv = 1;
  for (const [l, threshold] of JOB_XP_CURVE) {
    if (xp >= threshold) lv = l;
    else break;
  }
  return lv;
}

/**
 * 現職 LV の UI 進捗バー用。
 * - level: 現在 LV
 * - current: 現在 LV に入ってから積んだ XP
 * - next: 次 LV までに必要な XP (現 LV 内の分母)
 * LV 50 に到達後は next = 0 (打ち止め)
 */
export function jobXpToNextLevel(xp: number): { level: number; current: number; next: number } {
  const level = jobLevelFromXp(xp);
  const curEntry = JOB_XP_CURVE.find((e) => e[0] === level);
  const nextEntry = JOB_XP_CURVE.find((e) => e[0] === level + 1);
  const curThreshold = curEntry ? curEntry[1] : 0;
  if (!nextEntry) {
    return { level, current: xp - curThreshold, next: 0 };
  }
  return { level, current: xp - curThreshold, next: nextEntry[1] - curThreshold };
}

/** 現職 LV 用の XP 加算定数 (後方互換の別名。実体は tuning.XP_REWARDS)。 */
export const JOB_XP_REWARDS = XP_REWARDS;

/**
 * 個人 (プレイヤー) LV 用 XP 曲線。パラメータは tuning.PLAYER_LEVEL_TUNING。
 */
export const PLAYER_XP_CURVE: ReadonlyArray<readonly [level: number, threshold: number]> = buildXpCurve(
  PLAYER_LEVEL_TUNING.maxLevel,
  PLAYER_LEVEL_TUNING.coefficient,
  PLAYER_LEVEL_TUNING.exponent,
);

/** 共通: threshold(n) = round(coef * (n - 1)^exp)、LV1..maxLv。 */
function buildXpCurve(maxLv: number, coefficient: number, exponent: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    out.push([lv, Math.round(coefficient * Math.pow(lv - 1, exponent))]);
  }
  return out;
}

/** 累計 XP から個人 LV を計算。 */
export function playerLevelFromXp(xp: number): number {
  let lv = 1;
  for (const [l, threshold] of PLAYER_XP_CURVE) {
    if (xp >= threshold) lv = l;
    else break;
  }
  return lv;
}

/** 個人 LV の UI 進捗バー用。 */
export function playerXpToNextLevel(xp: number): { level: number; current: number; next: number } {
  const level = playerLevelFromXp(xp);
  const idx = PLAYER_XP_CURVE.findIndex((e) => e[0] === level);
  const curThreshold = idx >= 0 ? PLAYER_XP_CURVE[idx]![1] : 0;
  const nextEntry = idx >= 0 && idx + 1 < PLAYER_XP_CURVE.length ? PLAYER_XP_CURVE[idx + 1] : undefined;
  if (!nextEntry) return { level, current: xp - curThreshold, next: 0 };
  return { level, current: xp - curThreshold, next: nextEntry[1] - curThreshold };
}
