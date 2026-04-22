/**
 * カードの「能力テキスト」+「フレーバーテキスト」を生成する。
 * MTG に倣い:
 *   - 能力行 (ability): 認知機能の特徴を擬似能力として日本語で表現
 *     (例: 「俊敏 ― 他者の気配を先読みし、いち早く動き出す。」)
 *   - フレーバー (flavor): カード下部の italic、詩的な 1 文
 *
 * 実行: TinySwallow で 1 回の生成で両方を構造化出力 → 解析。
 * 失敗時は archetype ごとのハンドクラフト pool から抽選。
 */

import type { Archetype, CogFunction, DiagnosisResult, Rarity } from '@aozoraquest/core';
import {
  COGNITIVE_FUNCTIONS,
  JOBS_BY_ID,
  jobDisplayName,
  RARITY_GUIDANCE,
  RARITY_LABEL,
} from '@aozoraquest/core';
import { getGenerator } from './generator';
import { pickFallbackFlavor, pickFallbackEffect } from './job-flavor-fallback';

const COG_LABEL: Record<CogFunction, string> = {
  Ni: '内向直観 (本質を見抜く)',
  Ne: '外向直観 (可能性を広げる)',
  Si: '内向感覚 (積み重ねを信じる)',
  Se: '外向感覚 (今この瞬間に動く)',
  Ti: '内向思考 (論理の整合を組む)',
  Te: '外向思考 (結果で示す)',
  Fi: '内向感情 (自分の価値観に忠実)',
  Fe: '外向感情 (場の調和を整える)',
};

export interface CardTextSource {
  kind: 'llm' | 'fallback';
  backend?: 'webgpu' | 'wasm';
}

export interface CardText {
  /** 1 行の能力テキスト (キーワード ― 説明)。MTG のルール文相当。 */
  effect: string;
  /** 40-60 字の flavor text、italic 描画前提。 */
  flavor: string;
  source: CardTextSource;
}

function buildPrompt(result: DiagnosisResult, rarity: Rarity): { system: string; user: string } {
  const job = JOBS_BY_ID[result.archetype];
  const name = jobDisplayName(result.archetype);
  // 上位 4 認知機能
  const top = [...COGNITIVE_FUNCTIONS]
    .sort((a, b) => (result.cognitiveScores[b] ?? 0) - (result.cognitiveScores[a] ?? 0))
    .slice(0, 4);
  const topDesc = top.map((fn) => `${fn} ${COG_LABEL[fn]} (${result.cognitiveScores[fn] ?? 0})`).join('、');
  const rarityLabel = RARITY_LABEL[rarity];
  const rarityGuidance = RARITY_GUIDANCE[rarity];

  const system = [
    'あなたはトレーディングカードゲームのカード文を書く詩人兼デザイナーです。',
    '気質情報と希少度を受け取り、MTG 調のルール文 (能力) と古文書風フレーバーを',
    '日本語で 1 セット書きます。',
    '',
    `希少度は ${rarityLabel}。${rarityGuidance}`,
    '希少度が高いほど、響きも挙動も稀有で印象的な能力にすること。',
    '',
    '出力形式は以下の 2 行のみ。他に何も書かない。',
    '能力: <2〜5字キーワード> ― <20〜40字説明>',
    'フレーバー: <40〜60字の詩的な 1 文>',
    '',
    '禁止: Markdown、*強調*、「」『』《》の括弧、見出し記号 (# や ** など)、',
    '     前置き ("はい、" "わかりました" 等)、数値指定、3 行以上の出力。',
    '',
    '例 1 (希少度コモン):',
    '能力: 俊敏 ― 相手が気付く前に一歩動く。見た者はもう手遅れである。',
    'フレーバー: 影が動いたのではない。影になる前に、彼が動いただけだ。',
    '',
    '例 2 (希少度UR):',
    '能力: 星読み ― 敵味方の運命を重ねた光で束ね、盤面そのものを書き換える。',
    'フレーバー: 星の一つを彼の指が撫でた。銀河が、行儀よくページを捲った。',
  ].join('\n');

  const user = [
    `職業: ${name}`,
    `主機能: ${job.dominantFunction} (${COG_LABEL[job.dominantFunction]})`,
    `副機能: ${job.auxiliaryFunction} (${COG_LABEL[job.auxiliaryFunction]})`,
    `上位傾向: ${topDesc}`,
    `希少度: ${rarityLabel}`,
    '',
    '上の気質と希少度に合う「能力」と「フレーバー」を 1 組だけ書いてください。',
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

function stripWrappers(s: string): string {
  return s
    .replace(/^[「『《【〈"'“”]+/, '')
    .replace(/[」』》】〉"'“”]+$/, '')
    .trim();
}

/** LLM の出力から "能力:" と "フレーバー:" ブロックを抽出する。
 *  TinySwallow は小さいモデルで様式が崩れがちなので、いくつかの表記ゆれに対応する。 */
function parseLLMOutput(raw: string): { effect: string; flavor: string } | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);

  const HEADER_EFFECT = /^(?:能力|効果|アビリティ|スキル)[:\s::・　]*(.*)$/;
  const HEADER_FLAVOR = /^(?:フレーバー|flavor|情景|詩|口上)[:\s::・　]*(.*)$/i;

  let effect = '';
  let flavor = '';
  let pendingHeader: 'effect' | 'flavor' | null = null;

  for (const line of lines) {
    const lineClean = line.replace(/^[-・*#>\s]+/, '').trim();
    const effM = lineClean.match(HEADER_EFFECT);
    const flaM = lineClean.match(HEADER_FLAVOR);
    if (effM) {
      if (effM[1]!.trim()) {
        if (!effect) effect = stripWrappers(effM[1]!);
        pendingHeader = null;
      } else {
        pendingHeader = 'effect';
      }
      continue;
    }
    if (flaM) {
      if (flaM[1]!.trim()) {
        if (!flavor) flavor = stripWrappers(flaM[1]!);
        pendingHeader = null;
      } else {
        pendingHeader = 'flavor';
      }
      continue;
    }
    // ヘッダーの次行に本文が来るパターン
    if (pendingHeader === 'effect' && !effect) { effect = stripWrappers(lineClean); pendingHeader = null; continue; }
    if (pendingHeader === 'flavor' && !flavor) { flavor = stripWrappers(lineClean); pendingHeader = null; continue; }
  }

  // フォールバック: 明示的な header が見つからなかったら最初の 2 本文行を effect/flavor に割り振る
  if ((!effect || !flavor) && lines.length >= 2) {
    const plain = lines.filter((l) => !HEADER_EFFECT.test(l) && !HEADER_FLAVOR.test(l));
    if (plain.length >= 2) {
      if (!effect) effect = stripWrappers(plain[0]!);
      if (!flavor) flavor = stripWrappers(plain[1]!);
    }
  }

  if (!effect || !flavor) return null;
  // 長さサニティ (緩め)
  if (effect.length < 6 || effect.length > 160) return null;
  if (flavor.length < 10 || flavor.length > 180) return null;
  return { effect, flavor };
}

async function generateWithLLM(
  result: DiagnosisResult,
  rarity: Rarity,
  timeoutMs: number,
): Promise<CardText | null> {
  const gen = getGenerator();
  try {
    await gen.load();
  } catch (e) {
    console.warn('[card-text] generator load failed', e);
    return null;
  }
  const { system, user } = buildPrompt(result, rarity);
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  try {
    const fullPromise = gen.generate(messages);
    const raced = await Promise.race([
      fullPromise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('card-text LLM timeout')), timeoutMs)),
    ]);
    console.info('[card-text] raw LLM output:\n' + raced);
    const parsed = parseLLMOutput(raced);
    if (!parsed) {
      console.warn('[card-text] parse failed, falling back. raw length=', raced.length);
      return null;
    }
    console.info('[card-text] parsed → effect:', parsed.effect, '| flavor:', parsed.flavor);
    const source: CardTextSource = { kind: 'llm' };
    const backend = gen.getBackend();
    if (backend) source.backend = backend;
    return { ...parsed, source };
  } catch (e) {
    console.warn('[card-text] generation failed', e);
    return null;
  }
}

/** effect + flavor を生成 (メイン API)。失敗時は fallback。rarity を必ず渡す。 */
export async function generateCardText(
  result: DiagnosisResult,
  rarity: Rarity,
  opts: { seed?: number; timeoutMs?: number } = {},
): Promise<CardText> {
  const seed = opts.seed ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 60000;
  const llm = await generateWithLLM(result, rarity, timeoutMs);
  if (llm) return llm;
  return {
    effect: pickFallbackEffect(result.archetype, seed),
    flavor: pickFallbackFlavor(result.archetype, seed),
    source: { kind: 'fallback' },
  };
}

/** fallback だけ (テスト用) */
export function getFallbackCardText(archetype: Archetype, seed: number): CardText {
  return {
    effect: pickFallbackEffect(archetype, seed),
    flavor: pickFallbackFlavor(archetype, seed),
    source: { kind: 'fallback' },
  };
}

