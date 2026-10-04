/** 能力/フレーバーの 1-shot example とカードタイプ抽選・example 値ヘルパ。 flavor-text.ts から分割。 */
import type { Color, Rarity } from '@aozoraquest/core';
import { COLOR_NAME_JA, type Tone } from './card-text-themes';

/** クリーチャー以外 (instant/sorcery/artifact) 用 1-shot example。
 *  説明は能動動詞で終わる「行為」を書く。「能力名」+「説明」のみ。 */
export const ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
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
export const ARTIFACT_ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
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
export const CREATURE_ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
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
export const FLAVOR_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
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

const CARD_TYPES_JA = ['クリーチャー', 'インスタント', 'ソーサリー', 'アーティファクト'] as const;
export type CardTypeJa = (typeof CARD_TYPES_JA)[number];

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
export function pickCardType(seed?: number): CardTypeJa {
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

export function exampleManaCostFor(rarity: Rarity, primary: Color, type: CardTypeJa): string {
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

export function exampleAbilityCostFor(rarity: Rarity, _primary: Color, type: CardTypeJa): string {
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

export function exampleKeywordsFor(rarity: Rarity): string {
  if (rarity === 'common') return '警戒';
  if (rarity === 'uncommon') return '飛行';
  if (rarity === 'rare') return '飛行, 警戒';
  if (rarity === 'srare') return '速攻, 接死';
  if (rarity === 'ssr') return '飛行, 警戒, トランプル';
  return '二段攻撃, 絆魂, トランプル';
}

export function examplePowerFor(rarity: Rarity): number {
  if (rarity === 'common') return 1;
  if (rarity === 'uncommon') return 2;
  if (rarity === 'rare') return 3;
  if (rarity === 'srare') return 4;
  if (rarity === 'ssr') return 5;
  return 6;
}

export function exampleToughnessFor(rarity: Rarity): number {
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
  fighter: '研ぎ澄まされた技巧',
  artist: '色を編む者',
  captain: '指揮の灯火',
  miko: '清めの巫女',
  ninja: '忍び寄る混沌',
  performer: '即興の遊び手',
};

export function exampleCardNameFor(archetype: string): string {
  return CARD_NAME_EXAMPLES[archetype] ?? '名もなき旅人';
}
