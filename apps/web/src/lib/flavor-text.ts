/**
 * カードの「能力テキスト」+「フレーバーテキスト」を生成する。
 * MTG 風に: タイプ + マナコスト + 能力名 + 起動コスト + 効果説明 + フレーバーの 6 要素。
 *
 * 実行: LocalLLM (Gemini Nano 等) で 2 段階生成 (ability → flavor) → 解析。
 * 失敗時は archetype と primaryColor から fallback 値を合成。
 */

import type { Archetype, CardType, Color, DiagnosisResult, ManaCost, Rarity } from '@aozoraquest/core';
import {
  jobDisplayName,
  JOBS_BY_ID,
  manaCostTotal,
  RARITY_GUIDANCE,
  RARITY_LABEL,
  sanitizeManaCost,
} from '@aozoraquest/core';
import { generateWithLocalLLM, pickLocalLLM, type LLMGenResult } from './local-llm';
import { pickFallbackFlavor, pickFallbackEffect } from './job-flavor-fallback';

export interface CardTextSource {
  kind: 'llm' | 'fallback';
  /** llm が使った backend id (例: 'gemini-nano')。fallback の場合 undefined。 */
  backend?: string;
}

export interface CardEffect {
  /** キーワード名 (2-5 字)。例: 潜影 / 星読み */
  name: string;
  /** 効果説明 (20-50 字)。 */
  description: string;
}

export interface CardText {
  /** カード名 (4-12 字、能力テーマに沿った命名)。
   *  クリーチャーは「実体」を表す名詞句、それ以外は「行為・出来事・物」。
   *  カード上部の大きなタイトルに表示。MTG のカード名相当。 */
  cardName: string;
  /** カードタイプ (creature / artifact / instant / sorcery)。 */
  type: CardType;
  /** 召喚コスト (右上に表示するマナコスト)。 */
  manaCost: ManaCost;
  /** アビリティ起動コスト (creature の常時能力なら null)。 */
  abilityCost: ManaCost | null;
  /** タップして起動するか。クリーチャー / アーティファクトの起動コストとして使う。
   *  abilityCost と独立。タップだけ (マナなし) も、マナ + タップ も可。 */
  abilityTap: boolean;
  /** 能力 (名前 + 説明)。コストは abilityCost 側で構造化。 */
  effect: CardEffect;
  /** 40-60 字の flavor text、italic 描画前提。 */
  flavor: string;
  /** クリーチャーのキーワード能力 (例: 飛行 / 警戒 / 先制攻撃)。creature 以外は空配列。 */
  keywords: string[];
  /** クリーチャーのパワー。creature 以外は undefined。 */
  power?: number;
  /** クリーチャーのタフネス。creature 以外は undefined。 */
  toughness?: number;
  source: CardTextSource;
}

/** 希少度ごとの召喚コスト目安 (合計マナ数)。LLM はこの範囲で manaCost を生成。 */
const MANA_TOTAL_RANGE: Record<Rarity, [number, number]> = {
  common: [1, 2],
  uncommon: [2, 3],
  rare: [3, 4],
  srare: [4, 5],
  ssr: [5, 6],
  ur: [6, 8],
};

/** 色名 ↔ 1 文字記号 の双方向マップ。 */
const COLOR_NAME_JA: Record<Color, string> = { W: '白', U: '青', B: '黒', R: '赤', G: '緑' };
const COLOR_FROM_NAME: Record<string, Color> = {
  '白': 'W', 'W': 'W', 'w': 'W',
  '青': 'U', 'U': 'U', 'u': 'U',
  '黒': 'B', 'B': 'B', 'b': 'B',
  '赤': 'R', 'R': 'R', 'r': 'R',
  '緑': 'G', 'G': 'G', 'g': 'G',
};

const CARD_TYPE_FROM_JA: Record<string, CardType> = {
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
const SNS_HINT_ABILITY = [
  '舞台は Bluesky (青空) という SNS。MTG ファンタジーではなく、現代の SNS が世界観。',
  '効果は Bluesky の現象に根ざすこと。SNS 語彙: 投稿 / 下書き / リプライ / 引用リポスト / ブースト / いいね / フォロー / フォロワー / ミュート / ブロック / ピン留め / 通知 / フィード / タイムライン / ハッシュタグ / スレッド / アーカイブ / 既読 / 公開 / 限定公開 / DM。',
  '効果のイメージ: 投稿をブーストする / 下書きを公開する / フォロワーに通知する / ミュートする / 引用リポストで拡散する / フィードに割り込む / スレッドを伸ばす / 既読を付ける / ハッシュタグを伝染させる / 通知を一斉に鳴らす など。',
  'TCG メカニクス語彙はそのまま使ってよい: マナ / 属性 (色) / コスト / 起動 / 対象 / ライフ / クリーチャー / インスタント / ソーサリー / アーティファクト。',
  'ただし MTG 固有の領域/プレイ語彙は使わない: 山札 / 手札 / 墓地 / 場 / プレイヤー / ターン / 呪文 / 召喚 は説明文で使わないこと。プレイヤーは「フォロワー」「フォロー相手」「対象アカウント」と呼ぶ。',
  '効果は前向き寄りでも観察的でも皮肉でも OK。ただし SNS の現象に必ず根ざすこと。',
].join('\n');

/** SNS 世界観の短いヒント (flavor 用)。 */
const SNS_HINT_FLAVOR = [
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
type Tone = 'positive' | 'observational' | 'ironic';
const TONES: readonly Tone[] = ['positive', 'observational', 'ironic'];

const TONE_LABEL: Record<Tone, string> = {
  positive: '前向き',
  observational: '観察的',
  ironic: '皮肉まじり',
};

const TONE_DIRECTIVE: Record<Tone, string> = {
  positive: '前向きで明るく、最後はささやかな祝福・成功・繋がりで締める。皮肉や自嘲は使わない。',
  observational: '観察的・淡々と。状況を写し取るように書き、最後の一文に小さな発見を置く。',
  ironic: 'ユーモアや皮肉を含むが温度は冷たくしない。最後は自嘲気味の小さなオチで締める。',
};

function pickTone(seed?: number): Tone {
  if (seed === undefined) {
    return TONES[Math.floor(Math.random() * TONES.length)] ?? 'observational';
  }
  const i = Math.abs(Math.floor(seed)) % TONES.length;
  return TONES[i] ?? 'observational';
}

/** クリーチャー以外 (instant/sorcery/artifact) 用 1-shot example。
 *  説明は能動動詞で終わる「行為」を書く。「能力名」+「説明」のみ。 */
const ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: ['能力名: 朝の挨拶', '説明: フォロワー 1 人にいいねを 3 個まとめて贈る。'].join('\n'),
    observational: ['能力名: 通勤フィード', '説明: タイムライン上位 3 件のいいね数を 1 ずつ増やす。'].join('\n'),
    ironic: ['能力名: 指滑り送信', '説明: 下書きを 1 つランダムに公開する。取り消せない。'].join('\n'),
  },
  uncommon: {
    positive: ['能力名: 突発バズ', '説明: 自分の最新投稿のいいねを 2 時間だけ 5 倍にする。'].join('\n'),
    observational: ['能力名: 既読の影', '説明: 対象アカウントが過去 24 時間に閲覧した投稿 5 件を全フォロワーに公開する。'].join('\n'),
    ironic: ['能力名: 推敲漏れ', '説明: 対象アカウントの下書きをランダムに 1 つ公開し、フォロワー全員に通知する。'].join('\n'),
  },
  rare: {
    positive: ['能力名: 引用の連鎖', '説明: フォロー相手 1 人の投稿を引用リポストする。それを引用した全員のフォロワー数を 10 増やす。'].join('\n'),
    observational: ['能力名: 通知の譜面', '説明: 全フォロワーの今日の最初の投稿を時刻順に並べて 1 本のスレッドにまとめる。'].join('\n'),
    ironic: ['能力名: 三日断食', '説明: 対象アカウントは 3 日間いいねを付けられなくなる。'].join('\n'),
  },
  srare: {
    positive: ['能力名: 推し再生', '説明: アーカイブから自分の過去の人気投稿 1 つを復活させる。当時のいいね数が現在に加算される。'].join('\n'),
    observational: ['能力名: 不可視モード', '説明: 全フォロー相手のフィードから自分のアカウントを 24 時間だけ消す。'].join('\n'),
    ironic: ['能力名: フォロワー贄', '説明: 追加コストとしてあなたのフォロワーを半分失う。対象アカウントのフォロワー全員をあなたに振り向ける。'].join('\n'),
  },
  ssr: {
    positive: ['能力名: 青空合奏', '説明: 全フォロワーの今日の投稿に自動でいいねを付け、1 日いいねの上限を撤廃する。'].join('\n'),
    observational: ['能力名: タイムライン圏外', '説明: 24 時間、全フォロー相手のタイムラインを停止させ、あなたの投稿だけが流れる。'].join('\n'),
    ironic: ['能力名: 通知地震', '説明: 全フォロワーに 100 件の通知を一斉に送る。送信元は対象アカウントとして表示される。'].join('\n'),
  },
  ur: {
    positive: ['能力名: 青空再起動', '説明: 全フォロワーの未公開下書きを一斉公開し、各自に新規フォロワーを 100 名贈呈する。'].join('\n'),
    observational: ['能力名: 配線入替', '説明: 全フォロワーのフォロー関係を 24 時間ランダムに入れ替える。元には戻らない。'].join('\n'),
    ironic: ['能力名: ゼロ・フォロワー宣告', '説明: 追加コストとしてあなたは 7 日間ハッシュタグを使えない。対象アカウントのフォロワーを全員ゼロにする。'].join('\n'),
  },
};

/** アーティファクト用 1-shot example。SNS 上の「設置道具」(ボット/ピン留め/スケジューラ等)。
 *  起動型が中心 (generic マナのみで起動)。 */
const ARTIFACT_ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: ['能力名: 自動おはよう', '説明: 毎朝、全フォロワーに自動で「おはよう」を送る。'].join('\n'),
    observational: ['能力名: 既読カウンタ', '説明: あなたの最新投稿の閲覧数をリアルタイムで表示する。'].join('\n'),
    ironic: ['能力名: 誤字検出機', '説明: あなたの投稿の誤字を毎回 1 つ検出し、フォロワーに公開する。'].join('\n'),
  },
  uncommon: {
    positive: ['能力名: ピン留め拡声器', '説明: あなたのピン留め投稿のいいねを毎日 2 倍にする。'].join('\n'),
    observational: ['能力名: 通知ロガー', '説明: 全フォロワーの通知履歴を 24 時間分記録し、いつでも閲覧できる。'].join('\n'),
    ironic: ['能力名: 自動引用機', '説明: あなたの投稿は毎回ランダムなフォロワーに自動で引用リポストされる。'].join('\n'),
  },
  rare: {
    positive: ['能力名: 予約投稿スケジューラ', '説明: 起動時、下書き 5 つを最適な時間帯に自動投稿予約する。'].join('\n'),
    observational: ['能力名: ハッシュタグ・トラッカー', '説明: 任意のハッシュタグに新規投稿があるたび、あなたに通知する。'].join('\n'),
    ironic: ['能力名: 自動ミュート機', '説明: あなたの投稿に否定的なリプライを付けたアカウントを自動でミュートする。'].join('\n'),
  },
  srare: {
    positive: ['能力名: 共鳴アンプ', '説明: あなたの全投稿のいいね数を、フォロワー全体のいいね総和に永続的に連動させる。'].join('\n'),
    observational: ['能力名: タイムライン解析器', '説明: 起動時、全フォロー相手の投稿パターンを分析し、最適な発言時刻を表示する。'].join('\n'),
    ironic: ['能力名: 偽装通知発射台', '説明: 起動時、対象アカウントに任意のフォロワーからの偽通知を 10 件送る。'].join('\n'),
  },
  ssr: {
    positive: ['能力名: 自動拡散ボット', '説明: あなたが投稿するたび、全フォロワーが自動でブーストし、各フォロワーに通知が飛ぶ。'].join('\n'),
    observational: ['能力名: 影武者アカウント', '説明: あなたの全投稿が、無作為に選ばれた別アカウント名でも同時に投稿される。'].join('\n'),
    ironic: ['能力名: 永久ミュート機', '説明: 起動時、対象アカウントは全フォロワーの視界から永遠に消える。元には戻らない。'].join('\n'),
  },
  ur: {
    positive: ['能力名: 万能オラクル', '説明: 起動時、Bluesky 上の全投稿を読み、最もバズる文面を 1 通生成して投稿する。'].join('\n'),
    observational: ['能力名: 透視カメラ', '説明: 全アカウントの DM・下書き・ミュートリストを永続的に閲覧できる。'].join('\n'),
    ironic: ['能力名: 終末ボット', '説明: 起動時、Bluesky の全ハッシュタグを「#青空」に書き換える。元には戻らない。'].join('\n'),
  },
};

/** クリーチャー用 1-shot example。登場時 / 起動型 / 静的 のいずれかで、SNS 文脈の派手な効果。
 *  「能力名」+「説明」のみ (カード名は exampleCardNameFor で別途生成)。 */
const CREATURE_ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: ['能力名: 朝のさえずり', '説明: 登場時、フォロワー 1 人にいいねを 2 個贈る。'].join('\n'),
    observational: ['能力名: 静かな観測', '説明: あなたの最新投稿のいいねを 1 多くする。'].join('\n'),
    ironic: ['能力名: 指の独断', '説明: 登場時、下書きを 1 つランダムに公開する。'].join('\n'),
  },
  uncommon: {
    positive: ['能力名: 共鳴の歌い手', '説明: 登場時、フォロワー全員に通知を 1 つ送る。'].join('\n'),
    observational: ['能力名: 既読の目撃者', '説明: 登場時、対象アカウントの直近 3 件を全フォロワーに公開する。'].join('\n'),
    ironic: ['能力名: 軽率な口', '説明: 登場時、自分の下書きを 1 つ無作為に公開する。'].join('\n'),
  },
  rare: {
    positive: ['能力名: 推しの伝道者', '説明: あなたが投稿するたび、フォロワー全員のフィードに自動で引用リポストされる。'].join('\n'),
    observational: ['能力名: 沈黙の証人', '説明: 登場時、対象アカウントは 24 時間あなたの投稿に反応できない。'].join('\n'),
    ironic: ['能力名: 既読殺し', '説明: 登場時、対象アカウントは 3 日間いいねを付けられなくなる。'].join('\n'),
  },
  srare: {
    positive: ['能力名: 拡声の女王', '説明: あなたの投稿のいいねが永続的に倍になる。'].join('\n'),
    observational: ['能力名: 影のオブザーバー', '説明: 全フォロー相手のフィードからあなたのアカウントを永続的に不可視にする。'].join('\n'),
    ironic: ['能力名: 通知の悪魔', '説明: 起動時、対象アカウントに 50 件の通知を 1 秒間に送りつける。'].join('\n'),
  },
  ssr: {
    positive: ['能力名: 青空の使者', '説明: 登場時、フォロワー全員のフォロワー数を 50 増やす。'].join('\n'),
    observational: ['能力名: タイムラインの主', '説明: あなたの全投稿が、全フォロー相手のフィードで永続的に最上位に固定される。'].join('\n'),
    ironic: ['能力名: 偽装の影武者', '説明: 起動時、あなたの次の投稿の送信元を対象アカウントに偽装する。'].join('\n'),
  },
  ur: {
    positive: ['能力名: 青空の創造主', '説明: 登場時、全フォロワーに各 1000 名の新規フォロワーを贈る。あなたのフォロワー数は永続的に 10 倍。'].join('\n'),
    observational: ['能力名: 配線の番人', '説明: あなたが場にいる限り、全フォロワーのフォロー関係はあなたの意思で書き換えられる。'].join('\n'),
    ironic: ['能力名: 終末の呟き', '説明: 起動時、対象アカウントのフォロワーを全員ゼロにする。追加コスト: あなたは 7 日間ハッシュタグを使えない。'].join('\n'),
  },
};

/** フレーバー用の 1-shot example。トーン × 希少度の 2 軸。詩的 1 文。 */
const FLAVOR_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: '通勤路の桜が一輪、誰にも気づかれずに、今日は彼にだけ咲いた。',
    observational: '朝のホームに、いつもの顔と、いつもとちがう天気が並んでいる。',
    ironic: '意味があったのではない。指に先を越されただけだ。それでもいいねは 3 つ付く。',
  },
  uncommon: {
    positive: '笑いは伝染する。最初に笑った彼自身が、いちばん遅く気付いた。',
    observational: '既読は届く。返信は届かない。距離だけが、ゆっくりと近づいてくる。',
    ironic: '送信ボタンは昔から彼より素早い。反省会だけが毎晩、生真面目に開かれる。',
  },
  rare: {
    positive: '推しの一言を引用したら、見知らぬ十人と、同じ夜空を共有していた。',
    observational: '投稿時間は人柄を語る。語らせていることに、本人だけが気付いていない。',
    ironic: '沈黙は金だというが、相手にとっては無言の拷問だったりもする。',
  },
  srare: {
    positive: '合奏は揃わぬ拍子から始まる。揃ってしまえば、あとは奏でているだけだ。',
    observational: '早朝のタイムラインは別世界だ。同じ青空でも、誰が起きているかで色が変わる。',
    ironic: '眠気に負けた者は、翌朝自分の言葉と再会する。たいてい、泣く。',
  },
  ssr: {
    positive: '朝焼けを共有した夜は、ログインしていなくとも、確かに繋がっていた。',
    observational: '通知が一斉に鳴る瞬間、世界はほんのわずかに、同じ方向を向く。',
    ironic: '過去は消えない。ただ、掘り起こされるタイミングを、いつも待っている。',
  },
  ur: {
    positive: '青空は誰のものでもない。だからこそ、彼の一言で、世界はもう一度始められる。',
    observational: '再起動の合図は、いつも誰かの「おはよう」だ。それが今日の世界を作る。',
    ironic: '青空を一度、自分の名で畳んだ。畳み方が雑すぎて、誰も真似しようと思わなかった。',
  },
};

/** 能力 (ルールテキスト) 生成用プロンプト。タイプは JS 側で確定済みのものを受け取り、LLM には固定として渡す。 */
function buildAbilityPrompt(result: DiagnosisResult, rarity: Rarity, tone: Tone, fixedType: CardTypeJa): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];
  const job = JOBS_BY_ID[result.archetype];
  const primaryName = COLOR_NAME_JA[job.primaryColor];
  const [minMana, maxMana] = MANA_TOTAL_RANGE[rarity];
  const isCreature = fixedType === 'クリーチャー';
  const isArtifact = fixedType === 'アーティファクト';
  const isSpell = fixedType === 'インスタント' || fixedType === 'ソーサリー';

  const typeDescription =
    isCreature
      ? 'クリーチャー: あなたのアカウント上に常駐する「実体・キャラクター」。能力は「登場時 1 回」または「コストを払って起動」または「常時」。'
      : fixedType === 'インスタント'
        ? 'インスタント: 誰かの投稿への瞬発的 1 度きりの介入 (リプライ/引用リポスト/ミュート/通知/公開などの一手)。'
        : fixedType === 'ソーサリー'
          ? 'ソーサリー: 一度きりの大きな能動操作 (フォロワー全員へのアナウンス、フィードの再構築、キャンペーン投稿など)。'
          : 'アーティファクト: SNS 上の「設置した道具」(ボット/自動リプライ機/ピン留めの拡声器/予約投稿スケジューラ/外部連携 API/ハッシュタグ・トラッカー/ミュートフィルタ等)。基本的に無属性。';

  const system = [
    'あなたは Bluesky (SNS) を舞台にしたトレカのルールテキストを書くゲームデザイナーです。日本語で 1 枚分のカードを書きます。',
    SNS_HINT_ABILITY,
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    '',
    `今回のカードタイプは「${fixedType}」で固定です (変更不可)。`,
    typeDescription,
    '',
    ...(isCreature ? [
      'クリーチャー固有ルール:',
      '- カード名は「実体・存在・キャラクター」を表す名詞句にする。例: 「影忍びの夜想曲」「黄昏の編纂者」「微睡の歩哨」。動詞で終わる行為名 (「〜を紡ぐ」「〜を放つ」) は禁止。',
      '- 説明文は次のいずれか (混在 OK):',
      '  (a) 登場時能力: 「このクリーチャーが場に出たとき、〜する」 — 1 回だけ発動',
      '  (b) 起動型能力: 「〜する」(起動コスト欄にマナを書く)',
      '  (c) 静的能力: 「〜の間、〜する」「〜があるたびに、〜」',
      '  (d) 能力なし (キーワードだけで戦う) — その場合は説明に「〜」程度の短い宣言を書くか、キーワードと整合する短い説明',
      '- キーワード能力 (0-3 個まで、SNS 文脈に合うものを選ぶ):',
      '    飛行 (タイムラインを飛び越えて届く) / 警戒 (通知を見逃さない) / 先制攻撃 (リプライを先に届ける) /',
      '    速攻 (登場直後から動ける) / トランプル (フォロワー数の差を相手に押し付ける) / 接死 (1 撃で対象をミュートに追い込む) /',
      '    絆魂 (与えた影響と同量、自分のフォロワーが増える) / 二段攻撃 (1 アクションで 2 度発動) /',
      '    威迫 (フォロワー 2 人以上でないと反応できない) / 到達 (引用リポストの連鎖を断ち切れる) /',
      '    呪禁 (相手から指定されない) / 護法 (対象にされた時 1 マナの対価を要求) / 防衛 (フォロワーを守る、能動行動不可)',
      '- パワー / タフネス: 1-7 の整数。マナコスト総量 + キーワード数 を概ね反映 (例: 1 マナ 1/1、4 マナ 3/3、6 マナ 5/5)。',
    ] : isArtifact ? [
      'アーティファクト固有ルール:',
      '- カード名は「道具・装置・仕組み」を表す名詞句。例: 「ピン留めの拡声器」「予約投稿スケジューラ」「自動引用ボット」。',
      '- マナコストは色マナを含めず、generic のみで構成すること (無色)。',
      '- 起動コストを 1 マナ以上設定して、「{コスト}: 〜する」の起動型能力として書くのが基本。',
      '- キーワード能力なし、パワー / タフネスなし (該当欄は「なし」)。',
    ] : isSpell ? [
      `${fixedType}固有ルール:`,
      '- カード名は「行為・出来事」を表す名詞句。',
      '- 説明は能動動詞で終わる 1 度きりの効果を書く。',
      '- 起動コストは原則「なし」(マナコストで支払い済み)。説明文に代償行為 (下書き 1 つ破棄など) を埋め込んだ場合のみ追加コストとして書く。',
      '- キーワード能力なし、パワー / タフネスなし (該当欄は「なし」)。',
    ] : []),
    '',
    '',
    '色 (属性) の使い方:',
    `- このジョブの primary color は「${primaryName}」(${job.primaryColor})。クリーチャー / インスタント / ソーサリーでは ${primaryName}1 以上を必ず含める。`,
    '- 能力テーマに応じて補助色を 1 色まで足してよい (合計 2 色まで)。3 色以上は禁止。',
    '- アーティファクトのみ、色マナは 0 にして generic だけで構成する。',
    '',
    'マナコスト表記:',
    '- 例: 「赤1」「白2」「青1 generic1」「generic3」「なし」',
    '- 1 色マナが N 個欲しい時は「赤N」と数字で書く。',
    '- generic マナは「generic N」と書く。',
    '',
    `今回のタイプ「${fixedType}」では、マナコスト・色は次のように決める:`,
    isArtifact
      ? `- 無色 (アーティファクト)。マナコスト = 「generic${Math.max(minMana, 1)}」のように generic だけで合計 ${minMana}-${maxMana} マナ。色マナは入れない。`
      : `- ${primaryName} (${job.primaryColor}) を必ず色マナとして 1 つ以上含める。補助色を 1 色まで足してよい (合計 2 色まで)。3 色以上禁止。`,
    '',
    `今回のタイプ「${fixedType}」の起動コスト:`,
    isCreature
      ? '- 常時/状態能力 or 登場時能力なら「なし」。タップして発動する起動型能力なら「タップ」(または「T」) と書く。マナを伴うなら「タップ generic1」のようにマナと組み合わせる。'
      : isArtifact
        ? `- 道具を「起動」する想定。タップを含めるのが基本: 「タップ」「タップ generic1」「generic2」など。色マナを使ってもよいが、無色なら generic のみ。`
        : '- 原則「なし」(マナコストで支払い済み)。説明文上どうしても代償が必要な場合のみ「追加コスト」として書く。タップは使わない (場に居続けるカードではないため)。',
    '',
    `出力は次の ${isCreature ? 8 : 5} 行のみ。前置き・Markdown・括弧類・箇条書き禁止。`,
    'タイプ行は出力しない (固定値なので)。',
    `マナコスト: <合計 ${minMana}-${maxMana} マナ。${isArtifact ? 'generic のみ' : `${primaryName}1 以上を含む`}>`,
    `カード名: <4〜12字。${isCreature ? '実体・存在を表す名詞句' : '行為・出来事・物を表す名詞句'}>`,
    '能力名: <2〜8字。短いキーワード。例「潜影」「星読み」>',
    '起動コスト: <マナ表記、または「なし」>',
    '説明: <20〜50字。Bluesky の現象に基づくゲーム効果。MTG 固有の領域語 (山札/手札/墓地/場/プレイヤー/ターン/呪文/召喚) は禁止>',
    ...(isCreature ? [
      'キーワード: <カンマ区切り 0-3 個、または「なし」。例「飛行, 警戒」>',
      'パワー: <整数 1-7>',
      'タフネス: <整数 1-7>',
    ] : []),
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]} / 形式参考。タイプは出力しない):`,
    `マナコスト: ${exampleManaCostFor(rarity, job.primaryColor, fixedType)}`,
    `カード名: ${exampleCardNameFor(result.archetype)}`,
    (isCreature ? CREATURE_ABILITY_EXAMPLE : isArtifact ? ARTIFACT_ABILITY_EXAMPLE : ABILITY_EXAMPLE)[rarity][tone],
    `起動コスト: ${exampleAbilityCostFor(rarity, job.primaryColor, fixedType)}`,
    ...(isCreature ? [
      `キーワード: ${exampleKeywordsFor(rarity)}`,
      `パワー: ${examplePowerFor(rarity)}`,
      `タフネス: ${exampleToughnessFor(rarity)}`,
    ] : []),
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `カードタイプ: ${fixedType} (固定・変更不可)`,
    ...(isArtifact ? [] : [`primary color: ${primaryName} (${job.primaryColor}) — 色マナとして必ず含める`]),
    `希少度: ${rarityLabel} (マナコスト合計 ${minMana}-${maxMana})`,
    `雰囲気: ${RARITY_GUIDANCE[rarity]}`,
    `トーン: ${TONE_LABEL[tone]}`,
    '',
    `上記に合う 1 枚分の Bluesky 世界の「${fixedType}」カードを書いて。タイプ行は出力不要。`,
    '効果は必ず Bluesky の現象 (投稿/いいね/リポスト/フォロー/通知/フィード/タイムライン/下書き/アーカイブ/ハッシュタグ/スレッド/ミュート/ブロック/引用/ピン留め等) に根ざすこと。マナ/属性/コスト/カードタイプの TCG メカニクス語は使ってよい。ただし MTG 固有の領域語 (山札/手札/墓地/場/プレイヤー/ターン/呪文/召喚) は説明文で使わない。',
  ].join('\n');

  return { system, user };
}

const CARD_TYPES_JA = ['クリーチャー', 'インスタント', 'ソーサリー', 'アーティファクト'] as const;
type CardTypeJa = (typeof CARD_TYPES_JA)[number];

/** few-shot example の type 重み (合計 100)。MTG 同様クリーチャーがデフォルトなので過半数。
 *  example は LLM 出力に強く影響するので、ここの分布が概ね最終分布になる。
 *  アーティファクトは LLM が選びにくい (色マナ制約があるため) ので、example 提示頻度を高めに振る。 */
const EXAMPLE_TYPE_WEIGHTS: Record<CardTypeJa, number> = {
  'クリーチャー': 55,
  'インスタント': 12,
  'ソーサリー': 13,
  'アーティファクト': 20,
};

/** 重み付き抽選でカードタイプを毎回選ぶ (LLM ではなく JS が確定させる)。 */
function pickCardType(seed?: number): CardTypeJa {
  const r01 = seed === undefined
    ? Math.random()
    : (Math.abs(Math.floor(seed * 9301 + 49297)) % 233280) / 233280;
  let acc = 0;
  const r = r01 * 100;
  for (const t of CARD_TYPES_JA) {
    acc += EXAMPLE_TYPE_WEIGHTS[t];
    if (r < acc) return t;
  }
  return 'クリーチャー';
}

function exampleManaCostFor(rarity: Rarity, primary: Color, type: CardTypeJa): string {
  const name = COLOR_NAME_JA[primary];
  if (type === 'アーティファクト') {
    if (rarity === 'common') return 'generic1';
    if (rarity === 'uncommon') return 'generic2';
    if (rarity === 'rare') return 'generic3';
    if (rarity === 'srare') return 'generic4';
    if (rarity === 'ssr') return 'generic5';
    return 'generic6';
  }
  if (rarity === 'common') return `${name}1`;
  if (rarity === 'uncommon') return `${name}1 generic1`;
  if (rarity === 'rare') return `${name}2 generic1`;
  if (rarity === 'srare') return `${name}2 generic2`;
  if (rarity === 'ssr') return `${name}3 generic2`;
  return `${name}3 generic3`;
}

function exampleAbilityCostFor(rarity: Rarity, _primary: Color, type: CardTypeJa): string {
  if (type === 'インスタント' || type === 'ソーサリー') return 'なし';
  if (type === 'クリーチャー') {
    // 登場時/常時が多いので大半は「なし」。高 rarity でたまにタップ起動型を例示。
    if (rarity === 'srare' || rarity === 'ssr' || rarity === 'ur') return 'タップ';
    return 'なし';
  }
  // アーティファクト: タップを基本にする
  if (rarity === 'common' || rarity === 'uncommon') return 'タップ';
  if (rarity === 'rare') return 'タップ generic1';
  if (rarity === 'srare') return 'タップ generic2';
  return 'タップ generic2';
}

function exampleKeywordsFor(rarity: Rarity): string {
  if (rarity === 'common') return '警戒';
  if (rarity === 'uncommon') return '飛行';
  if (rarity === 'rare') return '飛行, 警戒';
  if (rarity === 'srare') return '速攻, 接死';
  if (rarity === 'ssr') return '飛行, 警戒, トランプル';
  return '二段攻撃, 絆魂, トランプル';
}

function examplePowerFor(rarity: Rarity): number {
  if (rarity === 'common') return 1;
  if (rarity === 'uncommon') return 2;
  if (rarity === 'rare') return 3;
  if (rarity === 'srare') return 4;
  if (rarity === 'ssr') return 5;
  return 6;
}

function exampleToughnessFor(rarity: Rarity): number {
  if (rarity === 'common') return 1;
  if (rarity === 'uncommon') return 2;
  if (rarity === 'rare') return 3;
  if (rarity === 'srare') return 4;
  if (rarity === 'ssr') return 5;
  return 6;
}

/** archetype 別のカード名例。LLM の few-shot として 1 つだけ提示。 */
const CARD_NAME_EXAMPLES: Record<string, string> = {
  sage: '黄昏の編纂者',
  mage: '理屈の織り手',
  shogun: '号令の旗手',
  bard: '気まぐれな旋律',
  seer: '星詠みの預言',
  poet: '余白の住人',
  paladin: '夜明けの守護',
  explorer: '風読みの旅人',
  warrior: '一閃の戦士',
  guardian: '静かな砦',
  fighter: '研ぎ澄まされた拳',
  artist: '色を編む者',
  captain: '指揮の灯火',
  miko: '清めの巫女',
  ninja: '忍び寄る混沌',
  performer: '即興の遊び手',
};

function exampleCardNameFor(archetype: string): string {
  return CARD_NAME_EXAMPLES[archetype] ?? '名もなき旅人';
}

/** フレーバーテキスト生成用プロンプト。トーンに沿った 1 文。displayName を自然に織り込ませる。 */
function buildFlavorPrompt(result: DiagnosisResult, rarity: Rarity, cardName: string, abilityName: string, tone: Tone, displayName?: string): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];

  const system = [
    'あなたはトレカのフレーバー作家です。能力の直下に添える 1 文を日本語で書きます。',
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    'ゲーム効果は書かない。詩的でありながら、上のトーン指示を守る。',
    'ユーザー名が与えられた場合、可能なら自然な形で 1 度だけ織り込む (「〜は…した」のような主語化)。',
    '不自然になるなら無理に入れず、第三者視点で書いてよい。',
    SNS_HINT_FLAVOR,
    '',
    '出力は次の 1 行のみ。前置き・Markdown・括弧類禁止。',
    'フレーバー: <40〜70字>',
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]}):`,
    `フレーバー: ${FLAVOR_EXAMPLE[rarity][tone]}`,
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `カード名: ${cardName}`,
    `能力名: ${abilityName}`,
    `希少度: ${rarityLabel}`,
    `トーン: ${TONE_LABEL[tone]}`,
    ...(displayName ? [`ユーザー名: ${displayName}`] : []),
    '',
    `「${cardName}」のフレーバーを 1 文で書いて。`,
  ].join('\n');

  return { system, user };
}

export function stripMarkdown(s: string): string {
  let t = s;
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(?<![\*])\*([^\*\n]+)\*(?![\*])/g, '$1');
  t = t.replace(/(?<![_])_([^_\n]+)_(?![_])/g, '$1');
  return t;
}

export function stripWrappers(s: string): string {
  return s
    .replace(/^[「『《【〈"'“”]+/, '')
    .replace(/[」』》】〉"'“”]+$/, '')
    .trim();
}

type HeaderKey = 'type' | 'manaCost' | 'cardName' | 'name' | 'abilityCost' | 'description' | 'keywords' | 'power' | 'toughness' | 'flavor';
const HEADERS: Record<HeaderKey, RegExp> = {
  type: /^(?:タイプ|種別|カードタイプ|type)[:\s：・　]*(.*)$/i,
  manaCost: /^(?:マナコスト|召喚コスト|cost|mana[\s-]?cost)[:\s：・　]*(.*)$/i,
  cardName: /^(?:カード名|タイトル|card[\s-]?name|title)[:\s：・　]*(.*)$/i,
  // 「キーワード」は能力名と混同しないよう、能力名側の正規表現から除いた。
  name: /^(?:能力名|能力|スキル名|アビリティ名|アビリティ|名前)[:\s：・　]*(.*)$/,
  abilityCost: /^(?:起動コスト|アビリティコスト|発動コスト|代償|消費)[:\s：・　]*(.*)$/,
  description: /^(?:説明|効果|能力説明|動作|挙動)[:\s：・　]*(.*)$/,
  keywords: /^(?:キーワード|キーワード能力|常在能力|keywords?)[:\s：・　]*(.*)$/i,
  power: /^(?:パワー|攻撃力|power|atk)[:\s：・　]*(.*)$/i,
  toughness: /^(?:タフネス|防御力|耐久|toughness|def)[:\s：・　]*(.*)$/i,
  flavor: /^(?:フレーバー|flavor|情景|詩|口上)[:\s：・　]*(.*)$/i,
};

const ALLOWED_KEYWORDS = [
  '飛行', '警戒', '先制攻撃', '速攻', 'トランプル', '接死', '絆魂',
  '二段攻撃', '威迫', '到達', '呪禁', '護法', '防衛',
];

function parseKeywordsString(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|0|-|—|―)$/i.test(trimmed)) return [];
  const tokens = trimmed.split(/[,、，\s/／]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    if (ALLOWED_KEYWORDS.includes(tok) && !out.includes(tok)) out.push(tok);
    if (out.length >= 3) break;
  }
  return out;
}

function parseStatNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|-|—|―)$/i.test(trimmed)) return undefined;
  const m = trimmed.match(/(\d+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 20) return undefined;
  return n;
}

/**
 * 「赤1 generic2」「白白 青」「なし」「0」みたいな自由形式の文字列を ManaCost に解釈。
 * 認識できないトークンは無視する (LLM 出力の揺れに耐える)。
 * 全部 0 / 空 / "なし" 系 → 空 ManaCost を返す。
 */
function parseManaCostString(raw: string): ManaCost {
  const trimmed = raw.trim();
  if (!trimmed || /^(なし|無し|none|0|-|—|―)$/i.test(trimmed)) return {};
  const out: { W?: number; U?: number; B?: number; R?: number; G?: number; generic?: number } = {};
  const add = (k: 'W' | 'U' | 'B' | 'R' | 'G' | 'generic', n: number) => {
    if (n <= 0) return;
    out[k] = (out[k] ?? 0) + n;
  };
  const tokens = trimmed.split(/[\s,、,+]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    const gMatch = tok.match(/^(?:generic|GE|無色|無)(\d*)$/i);
    if (gMatch) {
      add('generic', Number(gMatch[1] || '1'));
      continue;
    }
    if (/^\d+$/.test(tok)) {
      add('generic', Number(tok));
      continue;
    }
    let i = 0;
    while (i < tok.length) {
      const ch = tok[i]!;
      const color = COLOR_FROM_NAME[ch];
      if (color) {
        let j = i + 1;
        while (j < tok.length && /\d/.test(tok[j]!)) j++;
        const n = j > i + 1 ? Number(tok.slice(i + 1, j)) : 1;
        add(color, n);
        i = j;
      } else if (/^\d+/.test(tok.slice(i))) {
        const m = tok.slice(i).match(/^(\d+)/)!;
        add('generic', Number(m[1]!));
        i += m[1]!.length;
      } else {
        i++;
      }
    }
  }
  return sanitizeManaCost(out);
}

function parseCardTypeString(raw: string): CardType | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  for (const [key, value] of Object.entries(CARD_TYPE_FROM_JA)) {
    if (t.includes(key.toLowerCase())) return value;
  }
  return null;
}

interface ParsedAbility {
  type: CardType;
  manaCost: ManaCost;
  cardName: string;
  name: string;
  abilityCost: ManaCost | null;
  abilityTap: boolean;
  description: string;
  keywords: string[];
  power?: number;
  toughness?: number;
}

/** 能力用: type + manaCost + cardName + name + abilityCost + description (+ creature の場合は keywords/power/toughness) を抽出。 */
function parseAbilityOutput(raw: string): ParsedAbility | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const out = { type: '', manaCost: '', cardName: '', name: '', abilityCost: '', description: '', keywords: '', power: '', toughness: '' };
  type FieldKey = keyof typeof out;
  let pending: FieldKey | null = null;
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    let matched = false;
    for (const key of ['type', 'manaCost', 'cardName', 'name', 'abilityCost', 'description', 'keywords', 'power', 'toughness'] as const) {
      const m = lineClean.match(HEADERS[key]);
      if (!m) continue;
      matched = true;
      if (m[1]!.trim()) {
        if (!out[key]) out[key] = stripWrappers(m[1]!);
        pending = null;
      } else {
        pending = key;
      }
      break;
    }
    if (matched) continue;
    if (pending && !out[pending]) { out[pending] = stripWrappers(lineClean); pending = null; }
  }
  if (!out.name || !out.description) return null;
  const cardType = parseCardTypeString(out.type) ?? 'creature';
  const manaCost = parseManaCostString(out.manaCost);
  if (manaCostTotal(manaCost) === 0) return null;
  const abilityCostRaw = out.abilityCost.trim();
  // タップ表記の検出: 「タップ」「{T}」「T」(単独トークン) を含むか。
  const hasTap = /タップ|\{?\s*T\s*\}?/i.test(abilityCostRaw) && !!abilityCostRaw && !/^(なし|無し|none|-|—|―)$/i.test(abilityCostRaw);
  // タップ表記を除去してから マナを解釈 (パース側がタップ字を generic と誤解しないように)。
  const abilityCostMana = abilityCostRaw
    .replace(/\{?\s*T\s*\}?/gi, ' ')
    .replace(/タップ/g, ' ')
    .trim();
  const abilityCost: ManaCost | null =
    !abilityCostMana || /^(なし|無し|none|-|—|―)$/i.test(abilityCostMana)
      ? null
      : (() => {
          const parsed = parseManaCostString(abilityCostMana);
          return manaCostTotal(parsed) > 0 ? parsed : null;
        })();
  const abilityTap = hasTap;
  if (out.name.length < 1 || out.name.length > 20) return null;
  if (out.description.length < 6 || out.description.length > 180) return null;
  // cardName が抜けたら能力名で代替 (LLM が出してくれなかった時の安全弁)
  const cardName = (out.cardName && out.cardName.length >= 2 && out.cardName.length <= 24)
    ? out.cardName
    : out.name;
  const isCreature = cardType === 'creature';
  const keywords = isCreature ? parseKeywordsString(out.keywords) : [];
  const power = isCreature ? parseStatNumber(out.power) : undefined;
  const toughness = isCreature ? parseStatNumber(out.toughness) : undefined;
  return {
    type: cardType,
    manaCost,
    cardName,
    name: out.name,
    abilityCost,
    abilityTap,
    description: out.description,
    keywords,
    ...(power !== undefined ? { power } : {}),
    ...(toughness !== undefined ? { toughness } : {}),
  };
}

/** フレーバー用: 1 行だけ抽出。 */
function parseFlavorOutput(raw: string): string | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    const m = lineClean.match(HEADERS.flavor);
    if (m && m[1]!.trim()) {
      const t = stripWrappers(m[1]!);
      if (t.length >= 10 && t.length <= 200) return t;
    }
  }
  const plain = lines.filter((l) => !Object.values(HEADERS).some((rx) => rx.test(l)));
  if (plain.length > 0) {
    const t = stripWrappers(plain[0]!);
    if (t.length >= 10 && t.length <= 200) return t;
  }
  return null;
}

export class CardTextError extends Error {
  stage: 'load' | 'ability-generate' | 'ability-parse' | 'flavor-generate' | 'flavor-parse';
  raw?: string;
  cause?: unknown;
  constructor(stage: CardTextError['stage'], message: string, opts: { raw?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'CardTextError';
    this.stage = stage;
    if (opts.raw !== undefined) this.raw = opts.raw;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

async function callLLM(
  system: string,
  user: string,
  timeoutMs: number,
  tag: 'ability' | 'flavor',
): Promise<LLMGenResult> {
  const fullPromise = generateWithLocalLLM(
    { systemPrompt: system, history: [{ role: 'user', content: user }] },
    { temperature: 0.8, maxNewTokens: 400 },
  );
  const raced = await Promise.race([
    fullPromise,
    new Promise<null>((_, rej) => setTimeout(() => rej(new Error(`${tag} LLM timeout (${timeoutMs}ms)`)), timeoutMs)),
  ]);
  if (!raced) {
    throw new CardTextError('load', `${tag}: no local LLM available`);
  }
  console.info(`[card-text/${tag}] raw LLM output (${raced.backend}):\n` + raced.text);
  return raced;
}

/** 1 段階 (ability または flavor) を生成 + パース。失敗時は最大 attempts 回リトライ。 */
async function runStageWithRetry<T>(
  tag: 'ability' | 'flavor',
  stageGenerate: CardTextError['stage'],
  stageParse: CardTextError['stage'],
  prompt: { system: string; user: string },
  parse: (raw: string) => T | null,
  timeoutMs: number,
  attempts: number,
): Promise<{ parsed: T; backend: string }> {
  let lastErr: CardTextError | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let result: LLMGenResult;
    try {
      result = await callLLM(prompt.system, prompt.user, timeoutMs, tag);
    } catch (e) {
      lastErr = new CardTextError(stageGenerate, `${tag} generation failed (attempt ${attempt}/${attempts}): ${(e as Error)?.message ?? e}`, { cause: e });
      console.warn(`[card-text/${tag}] attempt ${attempt}/${attempts} generation failed, retrying`, e);
      continue;
    }
    const parsed = parse(result.text);
    if (parsed !== null) return { parsed, backend: result.backend };
    lastErr = new CardTextError(stageParse, `${tag} parse failed (attempt ${attempt}/${attempts}, length=${result.text.length})`, { raw: result.text });
    console.warn(`[card-text/${tag}] attempt ${attempt}/${attempts} parse failed, raw:\n${result.text}`);
  }
  throw lastErr ?? new CardTextError(stageGenerate, `${tag} failed after ${attempts} attempts`);
}

async function generateWithLLM(
  result: DiagnosisResult,
  rarity: Rarity,
  timeoutMs: number,
  tone: Tone,
  displayName?: string,
): Promise<CardText> {
  const half = Math.max(15000, Math.floor(timeoutMs / 2));
  const MAX_ATTEMPTS = 3;

  // タイプは JS 側で重み付き抽選して確定 (LLM に決めさせない)。
  const fixedTypeJa = pickCardType();
  const fixedType: CardType =
    fixedTypeJa === 'クリーチャー' ? 'creature'
    : fixedTypeJa === 'インスタント' ? 'instant'
    : fixedTypeJa === 'ソーサリー' ? 'sorcery'
    : 'artifact';

  console.info(`[card-text] tone=${tone} (${TONE_LABEL[tone]}), rarity=${rarity}, fixedType=${fixedType}`);

  // 1) 能力 (マナコスト + カード名 + 能力名 + 起動コスト + 説明 + creature の場合は keywords/P/T)
  const ability = await runStageWithRetry(
    'ability', 'ability-generate', 'ability-parse',
    buildAbilityPrompt(result, rarity, tone, fixedTypeJa), parseAbilityOutput, half, MAX_ATTEMPTS,
  );
  // type は固定値で上書き (LLM の出力に依存しない)。
  ability.parsed.type = fixedType;
  // クリーチャーで P/T が欠落していたら rarity から default を充てる (LLM の出し忘れ対策)。
  // 内容推論ではなく rarity → 固定値の default なので、ヒューリスティック補正には該当しない。
  if (fixedType === 'creature') {
    if (ability.parsed.power === undefined) ability.parsed.power = examplePowerFor(rarity);
    if (ability.parsed.toughness === undefined) ability.parsed.toughness = exampleToughnessFor(rarity);
  } else {
    ability.parsed.keywords = [];
    delete ability.parsed.power;
    delete ability.parsed.toughness;
  }
  console.info('[card-text/ability] parsed →', ability.parsed);

  // 2) フレーバー (詩的 1 行、displayName を自然に織り込む)
  const flavor = await runStageWithRetry(
    'flavor', 'flavor-generate', 'flavor-parse',
    buildFlavorPrompt(result, rarity, ability.parsed.cardName, ability.parsed.name, tone, displayName),
    parseFlavorOutput, half, MAX_ATTEMPTS,
  );
  console.info('[card-text/flavor] parsed →', flavor.parsed);

  return {
    cardName: ability.parsed.cardName,
    type: ability.parsed.type,
    manaCost: ability.parsed.manaCost,
    abilityCost: ability.parsed.abilityCost,
    abilityTap: ability.parsed.abilityTap,
    effect: { name: ability.parsed.name, description: ability.parsed.description },
    flavor: flavor.parsed,
    keywords: ability.parsed.keywords,
    ...(ability.parsed.power !== undefined ? { power: ability.parsed.power } : {}),
    ...(ability.parsed.toughness !== undefined ? { toughness: ability.parsed.toughness } : {}),
    source: { kind: 'llm', backend: flavor.backend },
  };
}

/** effect + flavor を生成 (メイン API)。rarity を必ず渡す。
 *  displayName を渡すと、flavor 生成時に LLM へ「自然なら織り込んで」と指示する。 */
export async function generateCardText(
  result: DiagnosisResult,
  rarity: Rarity,
  opts: { seed?: number; timeoutMs?: number; displayName?: string } = {},
): Promise<CardText> {
  const llm = await pickLocalLLM();
  if (!llm) {
    return getFallbackCardText(result.archetype, opts.seed ?? Date.now(), rarity);
  }
  const timeoutMs = opts.timeoutMs ?? 60000;
  const tone = pickTone(opts.seed);
  return await generateWithLLM(result, rarity, timeoutMs, tone, opts.displayName);
}

function buildFallbackCardText(archetype: Archetype, rarity: Rarity, seed: number): CardText {
  const raw = pickFallbackEffect(archetype, seed);
  const { name, description } = splitFallbackEffect(raw);
  const job = JOBS_BY_ID[archetype];
  return {
    cardName: exampleCardNameFor(archetype),
    type: 'creature',
    manaCost: fallbackManaCost(rarity, job.primaryColor),
    abilityCost: null,
    abilityTap: false,
    effect: { name, description },
    flavor: pickFallbackFlavor(archetype, seed),
    keywords: [],
    power: examplePowerFor(rarity),
    toughness: exampleToughnessFor(rarity),
    source: { kind: 'fallback' },
  };
}

/** 旧ハンドクラフト effect 文字列 "名前 ― 説明" を分割する。 */
function splitFallbackEffect(raw: string): { name: string; description: string } {
  const m = raw.match(/^([^\s—–\-]{1,8})\s*[—–\-―]\s*(.+)$/);
  if (m) return { name: m[1]!, description: m[2]! };
  return { name: raw.slice(0, 4), description: raw };
}

/** rarity と primaryColor から fallback の召喚コストを合成。 */
function fallbackManaCost(rarity: Rarity, primary: Color): ManaCost {
  const out: ManaCost = {};
  if (rarity === 'common') {
    out[primary] = 1;
  } else if (rarity === 'uncommon') {
    out[primary] = 1;
    out.generic = 1;
  } else if (rarity === 'rare') {
    out[primary] = 2;
    out.generic = 1;
  } else if (rarity === 'srare') {
    out[primary] = 2;
    out.generic = 2;
  } else if (rarity === 'ssr') {
    out[primary] = 3;
    out.generic = 2;
  } else {
    out[primary] = 3;
    out.generic = 3;
  }
  return out;
}

/** fallback だけ (テスト用) */
export function getFallbackCardText(archetype: Archetype, seed: number, rarity: Rarity = 'common'): CardText {
  return buildFallbackCardText(archetype, rarity, seed);
}
