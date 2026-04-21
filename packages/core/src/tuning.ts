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
 * 共鳴 (相性) スコアの重み。暫定値で、β データで再校正する前提 (docs/11-validation.md §実験 3)。
 *
 * 研究根拠:
 *  - Robins, Caspi, & Moffitt (2000): 性格特性の類似性と関係満足度の相関 r ≈ 0.22
 *    (中程度の効果量)。この知見がメタ分析系でも再現されており、similarity は
 *    小-中の正の予測子として扱われている。
 *  - Montoya & Horton 系のメタ分析: similarity の効果は小-中、complementarity は
 *    全体としては弱く、特定次元 (支配-服従、開放性) でのみ意味を持つ。
 *  - Dyrenforth et al. (2010): ペア間類似性は actor/partner 効果を除くと
 *    negligible という知見もあり、類似性の寄与も過度に強調しない方が良い。
 *  - MBTI / Socionics の intertype 理論 (duality など) は peer review で
 *    ほぼ検証されていない。本アプリは 16 archetype を扱うが、相性算出には
 *    その理論を直接使わず、RPG stat の連続ベクトルで行う。
 *
 * 結論: similarity を主、complementarity を補助、という従来設計は
 * 既存研究と整合する。重みは 0.6 / 0.4 のまま (11-validation.md §実験 3 で
 * 再校正予定)。
 */
/**
 * resonance の合成式:
 *   score = pairBase * pairCategory
 *         + statSimilarity * 類似度
 *         + statComplement * 相補性
 *
 * pairCategory を主、stat 類似/相補は微調整として扱う。理由:
 *  - 16 型診断の UX 期待 (型同士の関係カテゴリを見せる) と一致させる。
 *  - Big Five の類似性効果量 (r ≈ 0.22) は小-中なので、連続指標のみでは
 *    discrimination が弱く、カテゴリ色の方が実用的。
 *
 * 重みの合計は 1.0。pairBase を 0.6 で主にし、残り 0.4 を stat 2 軸で分ける。
 */
export const COMPATIBILITY_WEIGHTS = {
  pairBase: 0.6,
  statSimilarity: 0.25,
  statComplement: 0.15,
  /** 後方互換: 旧 API (resonance 2 軸版) の同名 key を参照するコード用 */
  similarity: 0.25,
  complementarity: 0.15,
} as const;

/** 相補性のスイートスポット: 軸ごとの差がこの区間に入っていれば +0.2 (5 軸合計で最大 1.0)。 */
export const COMPLEMENT_GAP_RANGE = {
  min: 10,
  max: 25,
  perAxisScore: 0.2,
} as const;

/**
 * 診断に取得する投稿件数。多いほど精度・安定性が上がるが、埋め込み計算の
 * レイテンシと Bluesky API の負荷が増える。
 */
export const DIAGNOSIS_POST_LIMIT = 300;

/**
 * 診断が成立する最小投稿数。これ未満は insufficient として返す。
 */
export const DIAGNOSIS_MIN_POST_COUNT = 50;

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

/** 診断対象にする 1 投稿あたりの最小文字数。短文ノイズを除外する。 */
export const DIAGNOSIS_MIN_POST_TEXT_LENGTH = 10;

/**
 * 認知スコアのギャップによる confidence 判定閾値 (04-diagnosis.md §信頼度)。
 *  gap1to2 or gap2to3 < minGap    → ambiguous
 *  gap1to2 < mediumGap             → medium
 *  それ以外 (high post count)      → high
 *  postCount < lowPostCount        → low
 */
export const DIAGNOSIS_CONFIDENCE_THRESHOLDS = {
  minGap: 5,
  mediumGap: 10,
  lowPostCount: 100,
} as const;

// ────────────────────────────────
// アクション / 認知分類 (per-post)
// ────────────────────────────────

/**
 * 行動分類の Top-1 と Top-2 の差分がこの値未満なら「分類不能」として扱う。
 * 低すぎると間違った分類を強行、高すぎると何も分類できない。
 */
export const ACTION_CLASSIFICATION_MIN_MARGIN = 0.02;

// ────────────────────────────────
// キャッシュ / API ページング
// ────────────────────────────────

/** 他ユーザーの archetype をメモリキャッシュに保持する時間 (ms)。 */
export const ARCHETYPE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Bluesky API の 1 ページ最大件数 (com.atproto.repo.listRecords / app.bsky.feed.*)。 */
export const BLUESKY_API_PAGE_LIMIT = 100;

/** ホームのタイムライン 1 ページ取得件数。 */
export const TIMELINE_PAGE_LIMIT = 30;

// ────────────────────────────────
// ステータス減衰 (weights.ts 系の anti-cheat パラメータ)
// ────────────────────────────────

export const STATS_TUNING = {
  /** アクション重みの半減期 (日)。古いアクションほど軽くなる。 */
  decayHalfLifeDays: 60,
  /** ステータスの下限値 (正規化後に 0 にしないための床)。 */
  minStatValue: 5,
  /** 1 日・1 アクション種別あたりの上限回数 (6 回目以降は weights=0)。 */
  dailyCapPerActionType: 5,
} as const;

/** 共鳴タイムラインのフレッシュネス: 投稿の古さで resonance をこの半減期で減衰。 */
export const RESONANCE_FRESHNESS_HALF_LIFE_HOURS = 48;

// ────────────────────────────────
// UI テキスト制限
// ────────────────────────────────

/** 投稿本文の最大文字数 (Bluesky API 上限に準拠)。 */
export const POST_MAX_LENGTH = 300;

/** 精霊チャットのユーザー入力最大文字数。短め推奨でコンテキスト節約。 */
export const SPIRIT_INPUT_MAX_LENGTH = 100;

/** 精霊チャットで LLM に渡す過去会話ターン数 (1 ターン = user + spirit)。 */
export const SPIRIT_CHAT_HISTORY_TURNS = 10;

/** 精霊の時間帯別挨拶の境界 (時)。morning < morningEnd <= day < dayEnd <= night。 */
export const GREETING_HOUR_BOUNDARIES = {
  morningEnd: 11,
  dayEnd: 18,
} as const;

// ────────────────────────────────
// アクティビティログ (透明性 UI)
// ────────────────────────────────

/** questLog に保持する投稿分類履歴の最大件数 (古いものから切り詰め)。 */
export const ACTIVITY_HISTORY_LIMIT = 50;

/** アクティビティ 1 件あたりの本文プレビュー文字数 (プライバシー考慮で短め)。 */
export const ACTIVITY_PREVIEW_LENGTH = 60;

// ────────────────────────────────
// 日次ボーナス / streak
// ────────────────────────────────

/**
 * 「昨日」と判定する時間差のマージン。
 * 24h * この値 を超えなければ streak を継続。UTC / localtime のずれ吸収。
 */
export const DAILY_BONUS_DAY_MARGIN_FACTOR = 1.5;

// ────────────────────────────────
// LV アップ演出
// ────────────────────────────────

/** LV アップオーバーレイの表示時間 (ms)。CSS keyframe と必ず同期させる。 */
export const LEVEL_UP_OVERLAY_DURATION_MS = 2200;
/** LV アップポップインの時間 (ms)。 */
export const LEVEL_UP_POP_DURATION_MS = 600;

// ────────────────────────────────
// 精霊召喚 / ポイント算出
// ────────────────────────────────

/** 精霊召喚に必要な via:AozoraQuest 投稿数。 */
export const SUMMON_THRESHOLD = 3;

/** ポイント集計時にスキャンする listRecords のページ数上限。 */
export const POINTS_SCAN_PAGES = 5;
