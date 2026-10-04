/**
 * カードの「能力テキスト」+「フレーバーテキスト」を生成する。
 * MTG 風に: タイプ + マナコスト + 能力名 + 起動コスト + 効果説明 + フレーバーの 6 要素。
 *
 * 実行: LocalLLM (Gemini Nano 等) で 2 段階生成 (ability → flavor) → 解析。
 * 失敗時は archetype と primaryColor から fallback 値を合成。
 */

import type { Archetype, CardType, Color, DiagnosisResult, ManaCost, Rarity } from '@aozoraquest/core';
import { JOBS_BY_ID } from '@aozoraquest/core';
import { generateWithLocalLLM, pickLocalLLM, type LLMGenResult } from './local-llm';
import { pickFallbackFlavor, pickFallbackEffect } from './job-flavor-fallback';
import { pickEffectInspirations } from './card-text-effect-samples';
import { pickCardType, examplePowerFor, exampleToughnessFor, exampleCardNameFor } from './card-text-examples';
import { parseKeywordsString, parseStatNumber, parseManaCostString, parseCardTypeString, parseAbilityOutput, parseFlavorOutput } from './card-text-parse';
import { buildAbilityPrompt, buildFlavorPrompt } from './card-text-prompts';
import { TONE_LABEL, pickTone, pickAbilityTheme, pickStructure, type Tone, type StructureId } from './card-text-themes';

export { stripMarkdown, stripWrappers } from './card-text-parse';

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

/** @internal test 用に export。本番コードからは直接呼ばない。 */
export function parseKeywordsString_TEST(raw: string): string[] {
  return parseKeywordsString(raw);
}
/** @internal test 用に export。 */
export function parseStatNumber_TEST(raw: string): number | undefined {
  return parseStatNumber(raw);
}
/** @internal test 用に export。 */
export function parseManaCostString_TEST(raw: string): ManaCost {
  return parseManaCostString(raw);
}
/** @internal test 用に export。 */
export function parseCardTypeString_TEST(raw: string): CardType | null {
  return parseCardTypeString(raw);
}
/** @internal test 用に export。 */
export function pickStructure_TEST(type?: 'creature' | 'instant' | 'sorcery' | 'artifact') {
  return pickStructure(type);
}
/** @internal test 用に export。 */
export function pickEffectInspirations_TEST(structureId: string, n: number): string[] {
  return pickEffectInspirations(structureId as StructureId, n);
}
/** @internal test 用に export。重み付き抽選を多数回実行した時の分布チェック用。 */
export function pickCardType_TEST(): string {
  return pickCardType();
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
    // temperature を高めに (0.95) して類似化を抑える。few-shot とテーマ/構造の制約で
    // 形式は崩れないが、語彙と発想は毎回ずらす。
    { temperature: 0.95, maxNewTokens: 400 },
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

  // テーマと効果構造もランダム化 (毎回違う切り口・型を強制して類似化を防ぐ)。
  const theme = pickAbilityTheme();
  const structure = pickStructure(fixedType);

  console.info(`[card-text] tone=${tone} (${TONE_LABEL[tone]}), rarity=${rarity}, fixedType=${fixedType}, theme="${theme}", structure="${structure.label}"`);

  // 1) 能力 (マナコスト + カード名 + 能力名 + 起動コスト + 説明 + creature の場合は keywords/P/T)
  const ability = await runStageWithRetry(
    'ability', 'ability-generate', 'ability-parse',
    buildAbilityPrompt(result, rarity, tone, fixedTypeJa, theme, structure), parseAbilityOutput, half, MAX_ATTEMPTS,
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
