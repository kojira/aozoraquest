/**
 * ブルスコン (LFM2.5) のカード文 (D-SLM-CARD-001 §4 案 (c))。
 *
 * タイプ・マナ・起動コスト・キーワード・P/T は JS で決め (example*For = 希少度連動の既定値)、
 * LLM には 4 行 (カード名 / 能力名 / 説明 / フレーバー) だけを書かせる。「カード名:」まで assistant に書いておき、その続きを生成する。
 * 不合格なら最大 3 回まで生成し直し、3 回とも駄目なら null (呼び出し側が fallback のカードにする)。
 */
import type { CardType, DiagnosisResult, Rarity } from '@aozoraquest/core';
import { jobDisplayName, JOBS_BY_ID, RARITY_LABEL } from '@aozoraquest/core';
import type { LLMInput, LocalLLM } from './local-llm';
import type { CardText } from './flavor-text';
import {
  exampleAbilityCostFor, exampleKeywordsFor, exampleManaCostFor, examplePowerFor, exampleToughnessFor, pickCardType, type CardTypeJa,
} from './card-text-examples';
import { parseAbilityOutput, parseFlavorOutput } from './card-text-parse';
import { CARD_TYPE_FROM_JA, pickAbilityTheme, pickTone, TONE_LABEL, type Tone } from './card-text-themes';

export const FOURLINE_PREFILL = 'カード名:';
/** 生成の上限 (4 行で 70〜100 tok)。prompt と合わせて ctx 1024 に収める。 */
const MAX_NEW_TOKENS = 160;
const CTX = 1024;
const ATTEMPTS = 3;
/** カードの評価 (card-eval-ts) と同じ値。 */
const TEMPERATURE = 0.95;
const REPETITION_PENALTY = 1.1;

const SYSTEM = 'あなたは Bluesky (SNS) が舞台のトレカのカードを書く。マナやタイプは決まっているので、指定の 4 行 (カード名 / 能力名 / 説明 / フレーバー) だけを日本語で出力し、他は一切書かない。\n'
  + 'カード名は 4〜12 字の名詞句。能力名は 2〜8 字。説明は Bluesky の現象 (投稿/いいね/リポスト/フォロー/通知/タイムライン等) に基づくゲーム効果を 20〜50 字。山札・手札・墓地・場・プレイヤー・ターン・呪文・召喚は使わない。\n'
  + 'フレーバーは効果を書かない詩的な 1 文 (40〜70 字)。';

const SHOTS: readonly (readonly [string, string])[] = [
  ['職業: 賢者\nカードタイプ: クリーチャー\nマナコスト: 青2\nパワー/タフネス: 2/3\n希少度: アンコモン\nトーン: 観察的\nテーマ: 深夜の推敲',
    'カード名: 夜更けの添削者\n能力名: 推敲\n説明: あなたの下書きが公開されるたび、誤字を 1 つ直してからタイムラインに流す。\nフレーバー: 既読は届く。返信は届かない。距離だけが、ゆっくりと近づいてくる。'],
  ['職業: 侍\nカードタイプ: インスタント\nマナコスト: 赤1 generic1\n希少度: レア\nトーン: 皮肉まじり\nテーマ: 炎上の火消し',
    'カード名: 一斉ミュートの太刀\n能力名: 静寂\n説明: 対象の投稿へのリプライ通知を 1 時間すべて止める。\nフレーバー: 沈黙は金だというが、相手にとっては無言の拷問だったりもする。'],
];

export interface FourLineCard { cardName: string; abilityName: string; description: string; flavor: string }

const LINES = [['cardName', 'カード名'], ['abilityName', '能力名'], ['description', '説明'], ['flavor', 'フレーバー']] as const;
const LENGTH: Record<keyof FourLineCard, [number, number]> = { cardName: [2, 16], abilityName: [1, 10], description: [10, 80], flavor: [15, 100] };
const FORBIDDEN = /手札|墓地|呪文|プレイヤー|ターン|召喚|山札|ライブラリ|ツイート|(^|[をにでがのは])場([にをでへ、。]|$)/;
const TONE_LEAK = new RegExp(`(${Object.values(TONE_LABEL).join('|')})[：:]`);

/** 生成結果 (prefill の続き) を 4 行に分ける。どれかが欠けた・範囲外・禁止語などは null。 */
export function parseFourLineCard(raw: string): FourLineCard | null {
  const lines = `${FOURLINE_PREFILL}${raw}`.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd());
  const out: Partial<FourLineCard> = {};
  for (const line of lines) {
    if (LINES.every(([k]) => out[k] !== undefined)) break; // 4 つ揃ったら 5 行目からは捨てる
    for (const [key, label] of LINES) {
      const m = line.match(new RegExp(`^\\s*${label}\\s*[:：]\\s*(.*)$`));
      if (m && out[key] === undefined) { out[key] = m[1]!.trim(); break; }
    }
  }
  for (const [key] of LINES) {
    const v = out[key];
    if (v === undefined) return null;
    const [min, max] = LENGTH[key];
    if ([...v].length < min || [...v].length > max) return null;
    if (/[A-Za-z]{3,}/.test(v) || TONE_LEAK.test(v)) return null;
  }
  if (FORBIDDEN.test(out.description!)) return null;
  return out as FourLineCard;
}

interface CardSpec { archetype: string; rarity: Rarity; typeJa: CardTypeJa; tone: Tone; theme: string; shots: 1 | 2 }

export function buildFourLinePrompt(spec: CardSpec): LLMInput {
  const job = JOBS_BY_ID[spec.archetype as keyof typeof JOBS_BY_ID];
  const creature = spec.typeJa === 'クリーチャー';
  const user = [
    `職業: ${jobDisplayName(spec.archetype)}`,
    `カードタイプ: ${spec.typeJa}`,
    `マナコスト: ${exampleManaCostFor(spec.rarity, job.primaryColor, spec.typeJa)}`,
    ...(creature ? [`パワー/タフネス: ${examplePowerFor(spec.rarity)}/${exampleToughnessFor(spec.rarity)}`] : []),
    `希少度: ${RARITY_LABEL[spec.rarity]}`,
    `トーン: ${TONE_LABEL[spec.tone]}`,
    `テーマ: ${spec.theme}`,
  ].join('\n');
  const history: LLMInput['history'] = [];
  for (const [u, a] of SHOTS.slice(0, spec.shots)) history.push({ role: 'user', content: u }, { role: 'assistant', content: a });
  history.push({ role: 'user', content: user });
  return { systemPrompt: SYSTEM, history };
}

/** 4 行と JS の固定値を既存の parser に通して CardText にする。 */
function toCardText(c: FourLineCard, spec: CardSpec, backend: string): CardText | null {
  const job = JOBS_BY_ID[spec.archetype as keyof typeof JOBS_BY_ID];
  const creature = spec.typeJa === 'クリーチャー';
  const ability = parseAbilityOutput([
    `タイプ: ${spec.typeJa}`,
    `マナコスト: ${exampleManaCostFor(spec.rarity, job.primaryColor, spec.typeJa)}`,
    `カード名: ${c.cardName}`,
    `能力名: ${c.abilityName}`,
    `起動コスト: ${exampleAbilityCostFor(spec.rarity, job.primaryColor, spec.typeJa)}`,
    `説明: ${c.description}`,
    ...(creature ? [`キーワード: ${exampleKeywordsFor(spec.rarity)}`, `パワー: ${examplePowerFor(spec.rarity)}`, `タフネス: ${exampleToughnessFor(spec.rarity)}`] : []),
  ].join('\n'));
  const flavor = parseFlavorOutput(`フレーバー: ${c.flavor}`);
  if (!ability || !flavor) return null;
  const type: CardType = CARD_TYPE_FROM_JA[spec.typeJa]!;
  return {
    cardName: ability.cardName,
    type,
    manaCost: ability.manaCost,
    abilityCost: ability.abilityCost,
    abilityTap: ability.abilityTap,
    effect: { name: ability.name, description: ability.description },
    flavor,
    keywords: creature ? ability.keywords : [],
    ...(creature && ability.power !== undefined ? { power: ability.power } : {}),
    ...(creature && ability.toughness !== undefined ? { toughness: ability.toughness } : {}),
    source: { kind: 'llm', backend },
  };
}

/** 4 行方式で 1 枚書く。3 回とも不合格なら null。 */
export async function generateFourLineCard(llm: LocalLLM, result: DiagnosisResult, rarity: Rarity, seed: number): Promise<CardText | null> {
  const spec: CardSpec = { archetype: result.archetype, rarity, typeJa: pickCardType(), tone: pickTone(seed), theme: pickAbilityTheme(), shots: 2 };
  let input = buildFourLinePrompt(spec);
  if (llm.countPromptTokens && (await llm.countPromptTokens(input, FOURLINE_PREFILL)) > CTX - MAX_NEW_TOKENS) {
    spec.shots = 1;
    input = buildFourLinePrompt(spec);
  }
  console.info(`[card-text/four-line] type=${spec.typeJa} tone=${spec.tone} theme="${spec.theme}" shots=${spec.shots}`);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let raw: string;
    try {
      raw = await llm.generate(input, { temperature: TEMPERATURE, maxNewTokens: MAX_NEW_TOKENS, prefill: FOURLINE_PREFILL, repetitionPenalty: REPETITION_PENALTY });
    } catch (e) {
      console.warn(`[card-text/four-line] attempt ${attempt}/${ATTEMPTS} generation failed`, e);
      continue;
    }
    const parsed = parseFourLineCard(raw);
    const card = parsed && toCardText(parsed, spec, llm.id);
    if (card) return card;
    console.warn(`[card-text/four-line] attempt ${attempt}/${ATTEMPTS} rejected, raw:\n${raw}`);
  }
  return null;
}
