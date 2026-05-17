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
  /** カード名 (4-12 字、能力テーマに沿った詩的な命名、例: 「忍び寄る混沌」)。
   *  カード上部の大きなタイトルに表示。MTG のカード名相当。 */
  cardName: string;
  /** カードタイプ (creature / artifact / instant / sorcery)。 */
  type: CardType;
  /** 召喚コスト (右上に表示するマナコスト)。 */
  manaCost: ManaCost;
  /** アビリティ起動コスト (creature の常時能力なら null)。 */
  abilityCost: ManaCost | null;
  /** 能力 (名前 + 説明)。コストは abilityCost 側で構造化。 */
  effect: CardEffect;
  /** 40-60 字の flavor text、italic 描画前提。 */
  flavor: string;
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

/** SNS 世界観の短いヒント (能力用)。 */
const SNS_HINT_ABILITY = [
  'SNS (投稿と繋がりの広場) が舞台。能力効果の文脈: 仲間に贈る / 場を温める / 手札を覗く / 山札を増やす / 投稿を引き出す など。',
  '効果は「ネガティブ縛り」ではない。明るい効果も歓迎。',
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

/** 能力 (ルール文) 用の 1-shot example。トーン × 希少度の 2 軸。
 *  「能力名」「説明」のみを例示 (タイプ・マナコスト・起動コストは buildAbilityPrompt
 *  側で動的に生成して合成)。 */
const ABILITY_EXAMPLE: Record<Rarity, Record<Tone, string>> = {
  common: {
    positive: ['能力名: 朝の挨拶', '説明: 仲間 1 人を選び、いいねを 1 個贈る。'].join('\n'),
    observational: ['能力名: 通勤途中', '説明: あなたの山札の一番上のカードを見る。山札の上に戻す。'].join('\n'),
    ironic: ['能力名: 指滑り', '説明: カードを 1 枚山札から引く。'].join('\n'),
  },
  uncommon: {
    positive: ['能力名: 笑いの伝染', '説明: 仲間 1 人を選び、そのプレイヤーの手札 1 枚を起こす。'].join('\n'),
    observational: ['能力名: 既読待ち', '説明: 対象プレイヤーが今ターン中に引いた最新の 1 枚を公開する。'].join('\n'),
    ironic: ['能力名: 推敲漏れ', '説明: 対象プレイヤーの手札を 1 枚ランダムに公開する。'].join('\n'),
  },
  rare: {
    positive: ['能力名: 推し布教', '説明: 仲間 1 人のカード 1 枚をコピーし、そのコピーを今ターン中にプレイできる。'].join('\n'),
    observational: ['能力名: 投稿時間表', '説明: 各プレイヤーは山札の一番上を公開し、コスト順に並べ直す。'].join('\n'),
    ironic: ['能力名: 既読スルー', '説明: 対象プレイヤーは今ターン 1 枚しかカードをプレイできない。'].join('\n'),
  },
  srare: {
    positive: ['能力名: 合奏', '説明: 仲間 2 人を選び、そのターン中に追加で 1 アクション行えるようにする。'].join('\n'),
    observational: ['能力名: 朝焼け会議', '説明: 全プレイヤーは手札を 1 枚公開する。最も低コストのカードを場に出す。'].join('\n'),
    ironic: ['能力名: 深夜の暴走', '説明: あなたの墓地のカードを 2 枚、手札に戻す。'].join('\n'),
  },
  ssr: {
    positive: ['能力名: 朝焼け宣言', '説明: 場にある全カードのコストを、このターンの間 1 軽くする。'].join('\n'),
    observational: ['能力名: タイムライン圏外', '説明: 場の全カードを 1 ターンの間、行動不能にする。'].join('\n'),
    ironic: ['能力名: 通知一斉ノック', '説明: 全プレイヤーのカードを墓地から 3 枚まで、手札に戻す。'].join('\n'),
  },
  ur: {
    positive: ['能力名: 青空再生', '説明: 全プレイヤーの墓地を全て山札に戻し、各自カードを 3 枚引く。'].join('\n'),
    observational: ['能力名: 青空の譜', '説明: 全プレイヤーの山札を混ぜ直し、各自手札を 5 枚に揃え直す。'].join('\n'),
    ironic: ['能力名: 世界征服', '説明: あなたの次のターン終了まで、全プレイヤーのカードの操作権を得る。'].join('\n'),
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

/** 能力 (ルールテキスト) 生成用プロンプト。タイプ + マナコスト + 能力名 + 起動コスト + 説明。 */
function buildAbilityPrompt(result: DiagnosisResult, rarity: Rarity, tone: Tone): { system: string; user: string } {
  const rarityLabel = RARITY_LABEL[rarity];
  const job = JOBS_BY_ID[result.archetype];
  const primaryName = COLOR_NAME_JA[job.primaryColor];
  const [minMana, maxMana] = MANA_TOTAL_RANGE[rarity];

  const system = [
    'あなたは MTG 風トレカのルールテキストを書くゲームデザイナーです。日本語で 1 枚分のカードを書きます。',
    SNS_HINT_ABILITY,
    `今回のトーン (${TONE_LABEL[tone]}): ${TONE_DIRECTIVE[tone]}`,
    '',
    'カードタイプの選び方:',
    '- クリーチャー: 自身の存在を表す常時能力 (起動コスト「なし」)',
    '- インスタント: 瞬発的・一度きりの能力 (起動コスト 1 マナ程度)',
    '- ソーサリー: 儀式的・一度きりの能力 (起動コスト 1-2 マナ)',
    '- アーティファクト: 装飾品・道具で、基本的に無属性 (= マナコストは generic のみ、色マナ無し)',
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
    '出力は次の 6 行のみ。前置き・Markdown・括弧類・箇条書き禁止。',
    'タイプ: <クリーチャー|アーティファクト|インスタント|ソーサリー>',
    `マナコスト: <合計 ${minMana}-${maxMana} マナ。色マナ + generic で組み立てる>`,
    'カード名: <4〜12字。能力テーマと整合する詩的な命名。例「忍び寄る混沌」「朝霧の歩哨」>',
    '能力名: <2〜8字。短いキーワード。例「潜影」「星読み」>',
    '起動コスト: <マナ表記、または「なし」(クリーチャー常時能力等)>',
    '説明: <20〜50字。具体的なゲーム効果のみ。詩的描写禁止>',
    '',
    `例 (${rarityLabel} / ${TONE_LABEL[tone]}):`,
    `タイプ: ${exampleTypeFor(rarity)}`,
    `マナコスト: ${exampleManaCostFor(rarity, job.primaryColor)}`,
    `カード名: ${exampleCardNameFor(result.archetype)}`,
    ABILITY_EXAMPLE[rarity][tone],
    `起動コスト: ${exampleAbilityCostFor(rarity, job.primaryColor)}`,
  ].join('\n');

  const user = [
    `職業: ${jobDisplayName(result.archetype)}`,
    `primary color: ${primaryName} (${job.primaryColor}) — クリーチャー/呪文では必須`,
    `希少度: ${rarityLabel} (マナコスト合計 ${minMana}-${maxMana})`,
    `雰囲気: ${RARITY_GUIDANCE[rarity]}`,
    `トーン: ${TONE_LABEL[tone]}`,
    '',
    '上記に合う 1 枚分のカードを書いて。',
  ].join('\n');

  return { system, user };
}

function exampleTypeFor(rarity: Rarity): string {
  if (rarity === 'rare') return 'インスタント';
  if (rarity === 'srare') return 'ソーサリー';
  return 'クリーチャー';
}

function exampleManaCostFor(rarity: Rarity, primary: Color): string {
  const name = COLOR_NAME_JA[primary];
  if (rarity === 'common') return `${name}1`;
  if (rarity === 'uncommon') return `${name}1 generic1`;
  if (rarity === 'rare') return `${name}2 generic1`;
  if (rarity === 'srare') return `${name}2 generic2`;
  if (rarity === 'ssr') return `${name}3 generic2`;
  return `${name}3 generic3`;
}

function exampleAbilityCostFor(rarity: Rarity, primary: Color): string {
  if (rarity === 'common' || rarity === 'uncommon') return 'なし';
  if (rarity === 'rare') return 'generic1';
  if (rarity === 'srare') return `${COLOR_NAME_JA[primary]}1`;
  return `${COLOR_NAME_JA[primary]}1 generic1`;
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

type HeaderKey = 'type' | 'manaCost' | 'cardName' | 'name' | 'abilityCost' | 'description' | 'flavor';
const HEADERS: Record<HeaderKey, RegExp> = {
  type: /^(?:タイプ|種別|カードタイプ|type)[:\s：・　]*(.*)$/i,
  manaCost: /^(?:マナコスト|召喚コスト|cost|mana[\s-]?cost)[:\s：・　]*(.*)$/i,
  cardName: /^(?:カード名|タイトル|card[\s-]?name|title)[:\s：・　]*(.*)$/i,
  name: /^(?:能力名|能力|キーワード|スキル名|アビリティ名|アビリティ|名前)[:\s：・　]*(.*)$/,
  abilityCost: /^(?:起動コスト|アビリティコスト|発動コスト|代償|消費)[:\s：・　]*(.*)$/,
  description: /^(?:説明|効果|能力説明|動作|挙動)[:\s：・　]*(.*)$/,
  flavor: /^(?:フレーバー|flavor|情景|詩|口上)[:\s：・　]*(.*)$/i,
};

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
  description: string;
}

/** 能力用: type + manaCost + cardName + name + abilityCost + description の 6 項目を抽出。 */
function parseAbilityOutput(raw: string): ParsedAbility | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
  const out = { type: '', manaCost: '', cardName: '', name: '', abilityCost: '', description: '' };
  type FieldKey = keyof typeof out;
  let pending: FieldKey | null = null;
  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    let matched = false;
    for (const key of ['type', 'manaCost', 'cardName', 'name', 'abilityCost', 'description'] as const) {
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
  const abilityCost: ManaCost | null =
    !abilityCostRaw || /^(なし|無し|none|-|—|―)$/i.test(abilityCostRaw)
      ? null
      : (() => {
          const parsed = parseManaCostString(abilityCostRaw);
          return manaCostTotal(parsed) > 0 ? parsed : null;
        })();
  if (out.name.length < 1 || out.name.length > 20) return null;
  if (out.description.length < 6 || out.description.length > 180) return null;
  // cardName が抜けたら能力名で代替 (LLM が出してくれなかった時の安全弁)
  const cardName = (out.cardName && out.cardName.length >= 2 && out.cardName.length <= 24)
    ? out.cardName
    : out.name;
  return {
    type: cardType,
    manaCost,
    cardName,
    name: out.name,
    abilityCost,
    description: out.description,
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

  console.info(`[card-text] tone=${tone} (${TONE_LABEL[tone]}), rarity=${rarity}`);

  // 1) 能力 (タイプ + マナコスト + カード名 + 能力名 + 起動コスト + 説明)
  const ability = await runStageWithRetry(
    'ability', 'ability-generate', 'ability-parse',
    buildAbilityPrompt(result, rarity, tone), parseAbilityOutput, half, MAX_ATTEMPTS,
  );
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
    effect: { name: ability.parsed.name, description: ability.parsed.description },
    flavor: flavor.parsed,
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
    abilityCost: fallbackAbilityCost(rarity, job.primaryColor),
    effect: { name, description },
    flavor: pickFallbackFlavor(archetype, seed),
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

/** rarity と primaryColor から fallback の起動コストを合成。低レアリティは passive (null)。 */
function fallbackAbilityCost(rarity: Rarity, primary: Color): ManaCost | null {
  if (rarity === 'common' || rarity === 'uncommon') return null;
  if (rarity === 'rare') return { generic: 1 };
  if (rarity === 'srare') return { [primary]: 1 };
  if (rarity === 'ssr') return { [primary]: 1, generic: 1 };
  return { [primary]: 2 };
}

/** fallback だけ (テスト用) */
export function getFallbackCardText(archetype: Archetype, seed: number, rarity: Rarity = 'common'): CardText {
  return buildFallbackCardText(archetype, rarity, seed);
}
