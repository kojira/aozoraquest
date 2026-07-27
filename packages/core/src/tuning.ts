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
 *
 * 例外: ブルスコンの試練 (バトル) のバランス値は自己完結モジュールとして
 * battle.ts の BATTLE_TUNING に集約している (docs/18-brusukon-trial.md)。
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
 * **職ごとのレベル上がりにくさ** (#536)。必要 XP に掛ける倍率。
 *
 * 強い職ほど大きくする = レベルが上がりにくい。「強い職は伸びが遅い」ことで、
 * 弱い職を数字で底上げしなくても最終的な到達点が揃う。
 *
 * 値は手で決めず、**連戦の持久力の実測から機械的に導く** (docs/19 §6.6)。
 * 単発の勝率ではなく持久力を使うのは、実際のプレイ単位が「街を出て戻るまで」だから。
 * 計測条件は tier1 / Lv1 / 装備なし / 全 16 職 × 30 試行。
 *
 * 導出は 3 段:
 * 1. 幾何平均で正規化して 0.35 乗する。持久力の開き 3.8 倍 (mage 3.4 戦 対 shogun 12.8 戦) を
 *    そのまま必要 XP に反映すると弱い職が育ちすぎて逆に追い越すので、1.59 倍まで圧縮する
 * 2. **最大値で割って上限を 1.0 にする**。幾何平均のままだと強い職の倍率が 1 を超え、
 *    **同じ XP のまま表示レベルが下がる** (将軍 Lv30 → Lv27 = Lv30 パッシブを失う)。
 *    レベルは XP から毎回導出するので、曲線を変えるだけで既存プレイヤーの到達点が動く。
 *    上限を 1.0 に寄せれば、職差 (1.59 倍) を保ったまま**誰のレベルも下がらない**
 * 3. 小数第 2 位で丸める
 *
 * 計測条件を変えたら (敵の強さを触ったら) 引き直す。
 */
/** 職差をどれだけ後半で薄めるか (#536)。0 = 定数倍のまま / 1 = Lv50 で職差ゼロ。
 *  **0.7** で「Lv1 の差 2.2 倍 → Lv50 で 1.27 倍」。DQ3 (Lv10 2.5 倍 → Lv50 1.46 倍) と
 *  同じ「序盤は個性・終盤は収束」の形。レベルアップ全回復 (#547) で職差が広がったので
 *  0.6 → 0.7 に上げた (そのままだと終盤も 1.38 倍のまま開いていた)。 */
export const JOB_LEVEL_PACE_DECAY = 0.7;

export const JOB_LEVEL_PACE: Record<string, number> = {
  // コメントの数字は導出元の連戦数 (下ほど長く粘れる = 上がりにくい)。
  // **反復して収束させた値** (#569)。導出は測定 → テーブル → 測定 … の不動点探索で、
  // 単純反復だと 2 周期で振動する (最大変化 0.070 のまま止まらない) ため緩和係数 0.5 を掛ける。
  // 14 反復で残差 0.02 (= 丸め幅 0.01 + sim のばらつき) まで収まり、
  // **pace の順序と耐久の順序が全 16 職で一致する** (逆転ゼロ)。
  mage: 0.52, // 4.2 戦
  bard: 0.54, // 4.8 戦
  sage: 0.56, // 5.6 戦
  seer: 0.56, // 5.6 戦
  miko: 0.56, // 5.7 戦
  poet: 0.57, // 6.4 戦
  artist: 0.62, // 7.2 戦
  paladin: 0.64, // 8.1 戦
  performer: 0.67, // 9.0 戦
  fighter: 0.69, // 9.8 戦
  ninja: 0.70, // 10.3 戦
  explorer: 0.71, // 10.5 戦
  warrior: 0.71, // 10.7 戦
  guardian: 0.76, // 12.9 戦
  captain: 0.89, // 22.4 戦
  shogun: 1.00, // 28.6 戦 (= 基準。ここが上限なので誰も基準曲線より遅くならない)
};

/**
 * `JOB_LEVEL_PACE` の**導出元データ** (連戦数)。`scripts/sim-endurance-levelup.mts` の
 * 実測値で、tier1 / 装備なし / レベルアップ全回復あり / 30 試行の平均。
 *
 * コメントに書くだけだと、テーブルだけ手で触ったときに**ずれても誰も気づかない**
 * (実際 mage はコメント 2.9 戦 に対し実測 5.0 戦 まで乖離し、pace の順序と耐久の
 * 順序が 4 組で逆転していた)。データとして持ち、順序の一致をテストで固定する。
 */
export const JOB_LEVEL_PACE_BASIS: Record<string, number> = {
  mage: 4.2,
  bard: 4.8,
  sage: 5.6,
  seer: 5.6,
  miko: 5.7,
  poet: 6.4,
  artist: 7.2,
  paladin: 8.1,
  performer: 9.0,
  fighter: 9.8,
  ninja: 10.3,
  explorer: 10.5,
  warrior: 10.7,
  guardian: 12.9,
  captain: 22.4,
  shogun: 28.6,
};

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
  /** 依頼クエストを受託して完了 (発注者が承認) するたびの固定 XP。
   *  現職 LV (jobLevel) に加算される (プレイヤー Lv は #507/#508 で廃止)。
   *  約 1 日分の活動量 (投稿 ~100 XP/日) 相当で、冒険 (受託) が確かな前進になるよう設定。 */
  questComplete: 100,
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
 * 診断に取得する投稿件数。多いほど精度・安定性が上がる。
 * WebGPU int4 ONNX 分類器で 1 post あたり ~30ms なので 500 でも数秒で終わる。
 */
export const DIAGNOSIS_POST_LIMIT = 500;

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
