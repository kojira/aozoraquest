/**
 * 共有型定義 (core 内部で完結するものは types.ts に、UI と共有するものは packages/types に)。
 */

export const STATS = ['atk', 'def', 'agi', 'int', 'luk'] as const;
export type Stat = (typeof STATS)[number];

export const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
export type CogFunction = (typeof COGNITIVE_FUNCTIONS)[number];

export const ARCHETYPES = [
  'sage', 'mage', 'shogun', 'bard',
  'seer', 'poet', 'paladin', 'explorer',
  'warrior', 'guardian', 'fighter', 'dancer',
  'captain', 'miko', 'gladiator', 'performer',
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export type StatVector = Record<Stat, number>;
export type CognitiveScores = Record<CogFunction, number>;

/** 5 軸ベクトルを配列で表現 (statOrder 順: atk, def, agi, int, luk) */
export type StatArray = readonly [number, number, number, number, number];

export interface JobDefinition {
  id: Archetype;
  names: { default: string; maker: string; alt: string };
  stats: StatArray;
  dominantFunction: CogFunction;
  auxiliaryFunction: CogFunction;
}

export interface Action {
  type: string;
  timestamp: number;
  weights: StatVector;
}

export type ActionType =
  | 'opinion_post' | 'analysis_post' | 'short_burst' | 'quick_reply'
  | 'empathy_reply' | 'humor_post' | 'quote_with_opinion' | 'quote_with_analysis'
  | 'thread_continue' | 'calm_debate_reply' | 'streak_maintain'
  | 'like_underseen' | 'like_regular' | 'repost_only';

export type Tag =
  | 'question' | 'distress' | 'goodnews' | 'humor' | 'analysis'
  | 'opinion' | 'underseen' | 'fresh' | 'debated';

export interface Quest {
  id: string;
  templateId: string;
  type: 'growth' | 'maintenance' | 'restraint';
  targetStat: Stat;
  description: string;
  requiredCount: number;
  currentCount: number;
  xpReward: number;
  forbiddenActionTypes?: ActionType[];
  issuedDate: string; // YYYY-MM-DD
}

export type Confidence = 'high' | 'medium' | 'low' | 'ambiguous' | 'insufficient';

/**
 * 現職 (archetype) の熟練度ステート。archetype が変わると 0 からやり直す。
 * 前職は `DiagnosisResult.jobHistory` に履歴として積まれる。
 */
export interface JobLevelState {
  archetype: Archetype;
  xp: number;
  joinedAt: string;              // この archetype に切り替わった ISO 日時
  lastDailyBonusDate?: string;   // 日次ボーナスを最後に付与した YYYY-MM-DD
  streakDays: number;            // 連続活動日数 (日次ボーナスの計算に使う)
}

/** 過去に就いたジョブの履歴エントリ。 */
export interface JobHistoryEntry {
  archetype: Archetype;
  peakLevel: number;
  totalXp: number;
  from: string;                  // ISO
  until: string;                 // ISO
}

export interface DiagnosisResult {
  archetype: Archetype;
  rpgStats: StatVector;
  cognitiveScores: CognitiveScores;
  confidence: Confidence;
  analyzedPostCount: number;
  analyzedAt: string; // ISO datetime
  jobLevel?: JobLevelState;
  jobHistory?: JobHistoryEntry[];
}
