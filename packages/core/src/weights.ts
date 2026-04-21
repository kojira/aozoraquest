import type { Action, ActionType, StatVector } from './types.js';

/**
 * 行動 × ステータス重み表 (03-game-design.md §重み表、docs/data/action-weights.json と同期)
 */
export const ACTION_WEIGHTS: Record<ActionType, StatVector> = {
  opinion_post:         { atk:  3, def: -1, agi:  0, int:  1, luk:  0 },
  analysis_post:        { atk:  1, def:  0, agi: -1, int:  3, luk:  0 },
  short_burst:          { atk:  0, def:  0, agi:  3, int: -1, luk:  1 },
  quick_reply:          { atk:  0, def: -1, agi:  2, int:  0, luk:  1 },
  empathy_reply:        { atk: -1, def:  1, agi:  0, int:  0, luk:  3 },
  humor_post:           { atk:  0, def:  0, agi:  0, int:  0, luk:  3 },
  quote_with_opinion:   { atk:  2, def: -1, agi:  0, int:  1, luk:  0 },
  quote_with_analysis:  { atk:  0, def:  0, agi: -1, int:  2, luk:  1 },
  thread_continue:      { atk:  0, def:  2, agi:  0, int:  1, luk:  0 },
  calm_debate_reply:    { atk: -1, def:  2, agi:  0, int:  1, luk:  0 },
  streak_maintain:      { atk:  0, def:  2, agi:  0, int:  0, luk:  0 },
  like_underseen:       { atk:  0, def:  0, agi:  0, int:  0, luk:  2 },
  like_regular:         { atk:  0, def:  0, agi:  0, int:  0, luk:  1 },
  repost_only:          { atk:  0, def:  0, agi:  1, int:  0, luk:  0 },
};

/**
 * 複数アクションが同時にマッチしたときの優先順位 (先勝ち)。
 * action-weights.json の resolutionOrder と同期。
 */
export const RESOLUTION_ORDER: readonly ActionType[] = [
  'quote_with_analysis',
  'quote_with_opinion',
  'calm_debate_reply',
  'empathy_reply',
  'quick_reply',
  'analysis_post',
  'humor_post',
  'opinion_post',
  'short_burst',
  'thread_continue',
  'like_underseen',
  'like_regular',
  'repost_only',
  'streak_maintain',
];

/** マッチした候補アクションから resolutionOrder で最優先を選ぶ */
export function resolveActionType(matched: readonly ActionType[]): ActionType | null {
  for (const a of RESOLUTION_ORDER) {
    if (matched.includes(a)) return a;
  }
  return null;
}

/** 指定アクションタイプのタイムスタンプ付き Action オブジェクトを生成 */
export function buildAction(type: ActionType, timestamp: number = Date.now()): Action {
  return { type, timestamp, weights: { ...ACTION_WEIGHTS[type] } };
}

export const ANTI_CHEAT = {
  sameUserLikeCooldownHours: 4,
  dailyLukCapFromLikes: 15,
  minReplyTextLength: 10,
  rapidReplyDecayAfterSeconds: 300,
  rapidReplyDecayFactor: 0.5,
} as const;
