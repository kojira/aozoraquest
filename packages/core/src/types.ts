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
  'warrior', 'guardian', 'fighter', 'artist',
  'captain', 'miko', 'ninja', 'performer',
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
 * 現職 (archetype) の熟練度ステート。archetype は post ごとには変わらず、
 * 明示的な再診断で archetype が切り替わったときに xp=0 リセット。
 */
export interface JobLevelState {
  archetype: Archetype;
  xp: number;
  joinedAt: string;              // この archetype になった ISO 日時
}

/**
 * 個人 (プレイヤー) の累積ステート。archetype が変わっても継続する。
 * 日次ボーナス / streak はプレイヤー単位で判定 (1 日 1 回の本体)。
 */
export interface PlayerLevelState {
  xp: number;
  lastDailyBonusDate?: string;   // 最後に日次ボーナスを付けた YYYY-MM-DD
  streakDays: number;
}

export interface DiagnosisResult {
  archetype: Archetype;
  rpgStats: StatVector;
  cognitiveScores: CognitiveScores;
  confidence: Confidence;
  analyzedPostCount: number;
  analyzedAt: string; // ISO datetime
  jobLevel?: JobLevelState;
  playerLevel?: PlayerLevelState;
  /** 投稿ごとの cognitive 再判定で、現 archetype と異なる候補が出ているときに埋まる。 */
  pendingArchetype?: Archetype;
  /** 同じ候補が何回連続で出たか。閾値以上で UI が転職バナーを出す。 */
  pendingArchetypeStreak?: number;
  /** カード用のフレーバーテキスト (TinySwallow 生成、引き直しで上書き)。 */
  flavorText?: string;
  /** フレーバーの発言者 (MTG 風の "— 表示名" 帰属)。フォロイーからランダムに選定。 */
  flavorAttribution?: string;
  /** カード能力テキスト (旧フィールド、連結文字列)。新データは cardEffectName/Cost/Description を優先。 */
  cardEffect?: string;
  /** 能力キーワード名 (2-5 字、例: 潜影 / 星読み)。 */
  cardEffectName?: string;
  /** 能力の発動コスト (0-5 の整数)。MTG のマナコスト相当。 */
  cardEffectCost?: number;
  /** 能力の説明文 (20-40 字)。 */
  cardEffectDescription?: string;
  /** カードレアリティ (引き直し毎に抽選)。 */
  cardRarity?: string;
  /** 同じレアリティでも 2 種類ある枠画像のどちらを採用したか (1 or 2)。 */
  cardFrameVariant?: number;
  /** カードを引いた時刻 (ISO)。flavorText / cardEffect / cardRarity はこの時刻で同期。 */
  cardDrawnAt?: string;
  /** 後方互換 */
  flavorGeneratedAt?: string;
}
