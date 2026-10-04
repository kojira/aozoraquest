/** カード能力/フレーバー生成の語彙定義: マナ範囲・色/タイプ対応表・SNS 世界観ヒント・トーン・テーマ・効果構造。 flavor-text.ts から分割。 */
import type { CardType, Color, Rarity } from '@aozoraquest/core';

/** 希少度ごとの召喚コスト目安 (合計マナ数)。LLM はこの範囲で manaCost を生成。 */
export const MANA_TOTAL_RANGE: Record<Rarity, [number, number]> = {
  common: [1, 2],
  uncommon: [2, 3],
  rare: [3, 4],
  srare: [4, 5],
  ssr: [5, 6],
  ur: [6, 8],
};

/** 色名 ↔ 1 文字記号 の双方向マップ。 */
export const COLOR_NAME_JA: Record<Color, string> = { W: '白', U: '青', B: '黒', R: '赤', G: '緑' };
export const COLOR_FROM_NAME: Record<string, Color> = {
  '白': 'W', 'W': 'W', 'w': 'W',
  '青': 'U', 'U': 'U', 'u': 'U',
  '黒': 'B', 'B': 'B', 'b': 'B',
  '赤': 'R', 'R': 'R', 'r': 'R',
  '緑': 'G', 'G': 'G', 'g': 'G',
};

export const CARD_TYPE_FROM_JA: Record<string, CardType> = {
  'クリーチャー': 'creature',
  'creature': 'creature',
  'アーティファクト': 'artifact',
  'artifact': 'artifact',
  'インスタント': 'instant',
  'instant': 'instant',
  'ソーサリー': 'sorcery',
  'sorcery': 'sorcery',
};

/** Bluesky / SNS 世界観の短いヒント (能力用)。 */
export const SNS_HINT_ABILITY = [
  '舞台は Bluesky (青空) という SNS。MTG ファンタジーではなく、現代の SNS が世界観。',
  '効果は Bluesky の現象に根ざすこと。SNS 語彙: 投稿 / 下書き / リプライ / 引用リポスト / ブースト / いいね / フォロー / フォロワー / ミュート / ブロック / ピン留め / 通知 / フィード / タイムライン / ハッシュタグ / スレッド / アーカイブ / 既読 / 公開 / 限定公開 / DM。',
  '効果のイメージ: 投稿をブーストする / 下書きを公開する / フォロワーに通知する / ミュートする / 引用リポストで拡散する / フィードに割り込む / スレッドを伸ばす / 既読を付ける / ハッシュタグを伝染させる / 通知を一斉に鳴らす など。',
  'TCG メカニクス語彙はそのまま使ってよい: マナ / 属性 (色) / コスト / 起動 / 対象 / ライフ / クリーチャー / インスタント / ソーサリー / アーティファクト。',
  'ただし MTG 固有の領域/プレイ語彙は使わない: 山札 / 手札 / 墓地 / 場 / プレイヤー / ターン / 呪文 / 召喚 は説明文で使わないこと。プレイヤーは「フォロワー」「フォロー相手」「対象アカウント」と呼ぶ。',
  '効果は前向き寄りでも観察的でも皮肉でも OK。ただし SNS の現象に必ず根ざすこと。',
].join('\n');

/** SNS 世界観の短いヒント (flavor 用)。 */
export const SNS_HINT_FLAVOR = [
  'SNS の場面例: 朝の挨拶 / 推し布教 / 共感のリプ / 不意の繋がり / 励まし / 朝焼けの共有 / 笑いの伝染 / 既読スルー / 推敲漏れ / 通知一斉。',
  'トーンは前向き・観察・皮肉のいずれかを毎回選び直す。同じ調子に偏らない。',
].join('\n');

/**
 * 出力トーンを毎回ランダムに切り替えて単調さを避ける。
 * - positive: 明るく前向き、ささやかな祝福や成功で締める
 * - observational: 観察的・淡々、最後の一文で小さな発見
 * - ironic: 皮肉まじり、自嘲オチ
 *
 * 1 枚のカード内では ability と flavor で同一トーンを使う (整合のため)。
 */
export type Tone = 'positive' | 'observational' | 'ironic';
const TONES: readonly Tone[] = ['positive', 'observational', 'ironic'];

export const TONE_LABEL: Record<Tone, string> = {
  positive: '前向き',
  observational: '観察的',
  ironic: '皮肉まじり',
};

export const TONE_DIRECTIVE: Record<Tone, string> = {
  positive: '前向きで明るく、最後はささやかな祝福・成功・繋がりで締める。皮肉や自嘲は使わない。',
  observational: '観察的・淡々と。状況を写し取るように書き、最後の一文に小さな発見を置く。',
  ironic: 'ユーモアや皮肉を含むが温度は冷たくしない。最後は自嘲気味の小さなオチで締める。',
};

export function pickTone(seed?: number): Tone {
  if (seed === undefined) {
    return TONES[Math.floor(Math.random() * TONES.length)] ?? 'observational';
  }
  const i = Math.abs(Math.floor(seed)) % TONES.length;
  return TONES[i] ?? 'observational';
}

/** 能力に毎回違う「切り口」を与えるためのテーマプール。
 *  生成時に 1 つランダムに選んで LLM に渡し、効果を発想する起点にしてもらう。
 *  毎回 prompt が変わるので、似通った出力に収束しにくくなる。 */
const ABILITY_THEMES: readonly string[] = [
  // 時間軸
  '深夜のテンション', '早朝の静寂', 'バズ後の虚無感', '通勤時間の暇つぶし', '寝落ち寸前',
  '残業中の現実逃避', '休日のだらけ', '時差ぼけ', '記念日の連投', '締切直前の現実逃避',
  // SNS 操作系
  'ブロックの連鎖', 'ミュートワード設定', 'ピン留め変更', 'リスト整理', 'シャドウバン',
  'フォロー解除祭', '鍵垢化', '通知 OFF', '既読スルー', 'カスタムフィード自作',
  'ハッシュタグ汚染', 'インプレッション操作', '引用リポスト爆撃', 'リプ欄の塹壕戦', 'クォート連鎖',
  // 投稿の性質
  'ポエム連投', '長文垂れ流し', '一言ボケ', '画像 4 枚オチ', 'スレッド埋め立て',
  '投票で煽る', 'バズ狙いの誤情報', 'リプライ職人', '深夜の懺悔', '寝起きの怪文書',
  // 関係性
  '相互フォロー解除', '推しとの邂逅', '古参の威圧', '新参の暴走', '友達の友達の友達',
  'タイムラインに紛れた本垢', 'サブ垢からの介入', 'リプ友の更新待ち', 'ファボ魔の追跡', '名指しせず当てこすり',
  // 概念
  '炎上の予兆', 'バズの引き際', 'タイムラインの空気', '無風投稿', 'プチ炎上の鎮火',
  '誤爆 DM', 'スクショ晒し', 'アルゴリズムの気まぐれ', 'BAN 寸前', '突然の公式マーク',
  // SNS 文化
  '朝のおはようツイート', '飯テロ', '通勤実況', '深夜の自分探し', '日記がわりの長文',
  '黒歴史の掘り起こし', 'プロフィール変更', 'アイコン詐欺', '名前変更', 'ヘッダー芸',
  // メタ
  'X からの避難民', 'Bluesky への移住', 'マストドンを兼業', 'スレッズに浮気', '本垢と裏垢の境界',
];

export function pickAbilityTheme(seed?: number): string {
  if (seed === undefined) {
    return ABILITY_THEMES[Math.floor(Math.random() * ABILITY_THEMES.length)] ?? '';
  }
  const i = Math.abs(Math.floor(seed)) % ABILITY_THEMES.length;
  return ABILITY_THEMES[i] ?? '';
}

/** 構造パターンの候補。LLM に「今回はこの構造で書け」と指定して、
 *  「登場時にいいね N 個贈る」のような同じ型ばかりにならないようにする。 */
export const STRUCTURE_PATTERNS: readonly { id: string; label: string; description: string }[] = [
  { id: 'etb', label: '登場時', description: '「このクリーチャーが場に出たとき、〜する」の登場時 1 回発動効果' },
  { id: 'triggered', label: '常在トリガー', description: '「あなたが〜するたびに、〜する」の繰り返しトリガー効果' },
  { id: 'static-buff', label: '静的バフ', description: '「あなたの〜は〜を持つ」「あなたの〜は〜される」の永続的な状態変更' },
  { id: 'activated-tap', label: 'タップ起動', description: '「タップして起動: 〜する」 (起動コスト「タップ」)' },
  { id: 'activated-mana', label: 'マナ起動', description: '「マナを払って起動: 〜する」 (起動コスト 1 マナ程度)' },
  { id: 'conditional', label: '条件発動', description: '「もし〜なら、〜する」のような前提条件付き効果 (フォロワー数や時刻、投稿数で分岐)' },
  { id: 'choice', label: '選択', description: '「次のうち 1 つを選ぶ: A / B」型の二択効果 (どちらも魅力的に)' },
  { id: 'drawback', label: '代償付き', description: '「〜の代わりに〜を失う」「強力な効果と引き換えに自分も損する」型' },
  { id: 'replacement', label: '置換', description: '「〜を受けるたび、代わりに〜として扱う」型の置換効果' },
  { id: 'sacrifice', label: '生贄', description: '「下書きを破棄して/フォロワーを差し出して、その代わりに〜する」型' },
  { id: 'all-affect', label: '全体作用', description: '「全フォロワーは〜する/される」「タイムライン全体に〜が起こる」型' },
  { id: 'target-curse', label: '対象呪い', description: '「対象アカウントは〜できなくなる/〜が起こり続ける」型のデバフ' },
];

/** カードタイプ毎に許容される構造 ID リスト。pickStructure と prompt の説明文の整合を取る要。 */
const STRUCTURE_BY_TYPE: Record<'creature' | 'instant' | 'sorcery' | 'artifact', readonly StructureId[]> = {
  // creature は場に居続けるカード。登場時 / 常在トリガー / 静的 / タップ起動 / マナ起動 / 選択 / 代償 が自然。
  // 「対象呪い」「全体作用」は creature 能力でも有り得るが、典型ではないので除外。
  creature: ['etb', 'triggered', 'static-buff', 'activated-tap', 'activated-mana', 'conditional', 'choice', 'drawback'],
  // instant/sorcery は 1 度きりの能動効果。
  // 'replacement' は「~を受けるたび、代わりに~として扱う」型で永続作用前提のため除外
  // (instant/sorcery は場に留まらず 1 度だけ解決するので「~するたび」と相性が悪い)。
  instant: ['conditional', 'choice', 'drawback', 'sacrifice', 'all-affect', 'target-curse'],
  sorcery: ['conditional', 'choice', 'drawback', 'sacrifice', 'all-affect', 'target-curse'],
  // artifact は道具。タップ起動 / マナ起動 / 静的が中心。
  artifact: ['activated-tap', 'activated-mana', 'static-buff', 'conditional', 'all-affect', 'target-curse'],
};

export function pickStructure(type?: 'creature' | 'instant' | 'sorcery' | 'artifact'): typeof STRUCTURE_PATTERNS[number] {
  // type 指定があればそれ用の構造リストでフィルタ、なければ全 12 構造から抽選。
  const allowedIds = type ? STRUCTURE_BY_TYPE[type] : null;
  const pool = allowedIds
    ? STRUCTURE_PATTERNS.filter((p) => (allowedIds as readonly string[]).includes(p.id))
    : STRUCTURE_PATTERNS;
  return pool[Math.floor(Math.random() * pool.length)] ?? STRUCTURE_PATTERNS[0]!;
}

export type StructureId = typeof STRUCTURE_PATTERNS[number]['id'];
