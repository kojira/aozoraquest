/**
 * ゲームバランス / 診断アルゴリズムの調整パラメータを一箇所に集約する。
 *
 * 他のソースファイルでマジックナンバー (XP カーブ係数、recency 半減期、ブレンド係数 …)
 * をインラインで書くのは避け、必ずここから import して使うこと。試行錯誤や仕様変更の
 * 際に「どこの数値をいじれば挙動が変わるか」を本ファイル 1 つに閉じ込める。
 *
 * 変更時の注意:
 * - 値を変えると既存ユーザーの LV / XP や archetype 判定の結果が変わり得る。
 * - UI 側のメッセージと整合が取れているか確認すること。
 * - docs/03-game-design.md §XP とレベル、docs/04-diagnosis.md §処理 も同期更新する。
 */

// ────────────────────────────────
// XP カーブ
// ────────────────────────────────

/**
 * 現職 (archetype) 滞在 LV 用 XP 曲線のパラメータ。
 * threshold(n) = round(coefficient * (n - 1)^exponent)、LV1 は 0 XP。
 * 標準ユーザー (約 100 XP/日) で 1 年強で LV50 近傍到達を想定。
 */
export const JOB_LEVEL_TUNING = {
  maxLevel: 50,
  coefficient: 30,
  exponent: 1.85,
} as const;

/**
 * 個人 (プレイヤー) LV 用 XP 曲線のパラメータ。JobLV より緩やかで
 * 上限も高くし、長期プレイで積み上げられるようにする。
 */
export const PLAYER_LEVEL_TUNING = {
  maxLevel: 99,
  coefficient: 60,
  exponent: 1.95,
} as const;

/** XP 源ごとの加算量。post / quest / daily / streak の 4 系統。 */
export const XP_REWARDS = {
  /** 投稿が action 分類に成功するたびの XP */
  postMatch: 5,
  /** 日次ボーナス (その日 1 回だけ) */
  dailyBonus: 30,
  /** streak 1 日あたりの追加 XP */
  streakBonusPerDay: 3,
  /** streak 追加の上限 (streakBonusPerDay * n でこの値にキャップ) */
  streakBonusCap: 50,
} as const;

// ────────────────────────────────
// 投稿処理 (post-processor)
// ────────────────────────────────

/**
 * 認知スコアのブレンド比率。次の cognitiveScores = α * 既存 + (1 - α) * 新投稿。
 * 大きいほど変化が遅い (α=0.97 で 1 投稿あたり 3% の影響)。
 */
export const COGNITIVE_BLEND_ALPHA = 0.97;

/**
 * 転職候補 (pendingArchetype) が何投稿連続で出たら「転職可能」バナーを出すかの閾値。
 * 低すぎると flip-flop で煩く、高すぎると気付きにくい。
 */
export const JOB_CHANGE_STREAK_THRESHOLD = 3;

// ────────────────────────────────
// 診断パイプライン (時間軸重み付け)
// ────────────────────────────────

/**
 * Archetype 適合度 (気質スタック 4 層) の重み。
 * fit(j) = dom*scores[dom] + aux*scores[aux] + tertiary*scores[tertiary] + inferior*scores[inferior]
 *
 * - 各気質は dom > aux > tertiary > inferior の順で強く出るのが理想形。
 * - フォールバックではなく全 16 archetype に対して fit を計算し、argmax で決定する。
 */
export const ARCHETYPE_FIT_WEIGHTS = {
  dom: 1.0,
  aux: 0.7,
  tertiary: 0.3,
  inferior: 0.1,
} as const;

/**
 * 診断時に投稿の時間情報を使った重み付けで使う定数群。
 */
export const DIAGNOSIS_TIME_WEIGHTING = {
  /** バースト判定: この時間内に連続した投稿は「まとまった気分」とみなし重みを割る。 */
  burstWindowMs: 5 * 60 * 1000,
  /**
   * recency の線形減衰の半減期 (この経過時間で重みが 0.5 になる勾配)。
   * 30 日で 0.5 (直線)、180 日以降は floor。
   */
  halfLifeMs: 30 * 24 * 60 * 60 * 1000,
  /** 線形減衰の傾き (halfLifeMs 経過で weight が 0.5 減少の振れ幅)。 */
  decayAmplitude: 0.5,
  /** recency 重みの下限。これ以上は古くても軽くしない。 */
  minRecencyWeight: 0.25,
} as const;
