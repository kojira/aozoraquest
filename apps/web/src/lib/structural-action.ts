/**
 * 投稿の「構造的特徴」から確定的に判定できる action タイプ。
 *
 * `action-classifier.ts` のテキスト分類 (5 カテゴリ) は内容ベースで曖昧 (margin が
 * 小さいと null)、かつ ActionType の半分しか出せない。一方で post の record 構造
 * (返信か / 引用か / 文字数 / 親が誰か) は決定的に取れるので、これを併用すれば
 * `quote_with_opinion` `quote_with_analysis` `thread_continue` `calm_debate_reply`
 * などが「テキスト分類 + 構造」の合成で確定的にカウントできる。
 *
 * ※ `quick_reply` は親 post の indexedAt 取得が要るのでここでは未対応 (返信か否か
 *   までは取る)。`streak_maintain` `repost_only` `like_underseen` は別 pipeline。
 */

import type { ActionType } from '@aozoraquest/core';
import type { ActionCategory } from './action-classifier';

export interface PostStructure {
  /** 返信か (record.reply が存在) */
  isReply: boolean;
  /** 自分自身の post への返信か (= スレッド継続)。isReply 必須。 */
  isReplyToSelf: boolean;
  /** 引用ポスト (embed.record があるか) */
  isQuote: boolean;
  /** 投稿テキストの文字数 (preprocess 前の生 text) */
  textLength: number;
}

/**
 * テキスト分類結果 + 構造 → 当該 post に該当する ActionType の集合。
 *
 * - text 分類が出した action はそのまま採用 (5 カテゴリ)
 * - quote × textAction → quote_with_*
 * - reply 自分自身 → thread_continue
 * - reply × analysis → calm_debate_reply (議論への落ち着いた返答の proxy)
 * - 文字数 ≥200 → analysis_post (テキスト分類が外しても拾う)
 * - 文字数 ≤80 で且つ analysis_post でない → short_burst を補助的に追加
 */
export function deriveActionTypes(
  textAction: ActionCategory | null,
  s: PostStructure,
): Set<ActionType> {
  const out = new Set<ActionType>();
  if (textAction && textAction !== 'neutral') {
    out.add(textAction as ActionType);
  }

  // 長文は textAction によらず analysis_post 扱い
  if (s.textLength >= 200) out.add('analysis_post');
  // 短文 (80 字以下) かつ analysis でないなら short_burst 補助
  if (s.textLength > 0 && s.textLength <= 80 && !out.has('analysis_post')) {
    out.add('short_burst');
  }

  // 引用 + 内容 → 合成 action
  if (s.isQuote) {
    if (out.has('opinion_post')) out.add('quote_with_opinion');
    if (out.has('analysis_post')) out.add('quote_with_analysis');
  }

  // 自分への返信 = スレッド継続
  if (s.isReplyToSelf) out.add('thread_continue');

  // 返信 + 分析調 = 落ち着いた議論への参戦の proxy
  if (s.isReply && out.has('analysis_post')) out.add('calm_debate_reply');

  return out;
}
