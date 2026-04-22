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
    'あなたはトレーディングカードゲームのカード文を書くデザイナーです。',
    '指定された気質と希少度から、MTG のルール文とフレーバーテキストを日本語で作ります。',
    '',
    `このカードの希少度は ${rarityLabel} です。`,
    `${rarityLabel} にふさわしい性格: ${rarityGuidance}`,
    '希少度が高いほど珍しく印象的な能力を書いてください。',
    '',
    '出力はちょうど 2 ブロック。必ず以下の形式を守ってください:',
    '能力: <キーワード> ― <20-40 字の説明>',
    'フレーバー: <40-60 字の 1 文>',
    '',
    '規則:',
    '- 能力行は MTG の "Ward 2" "Flash" のような短いキーワード名 + ダッシュ ― + 説明文。',
    '- キーワードは 2-5 文字の日本語造語 (例: 先読、共鳴、俊敏、遠望、執心、潜影)。',
    '- 説明文は常体、20-40 字。具体的な数値は書かず、気質の性質を動的に描写する。',
    '- フレーバーは地の文の 1 文、40-60 字、詩的に。常体。',
    '- Markdown (**、*、_ など) を一切使わない。見出し記号も使わない。',
    '- 括弧 (「」『』《》) を使わない。',
    '- 「能力:」「フレーバー:」以外の見出しや前置きを付けない。',
    '- 合計 2 行だけ出力する。',
  ].join('\n');

  const user = [
    `職業: ${name}`,
    `主機能: ${job.dominantFunction} (${COG_LABEL[job.dominantFunction]})`,
    `副機能: ${job.auxiliaryFunction} (${COG_LABEL[job.auxiliaryFunction]})`,
    `上位傾向: ${topDesc}`,
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

/** LLM の出力から "能力:" と "フレーバー:" ブロックを抽出する。 */
function parseLLMOutput(raw: string): { effect: string; flavor: string } | null {
  const text = stripMarkdown(raw.replace(/\r\n/g, '\n'));
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);

  let effect = '';
  let flavor = '';
  for (const line of lines) {
    const effM = line.match(/^(?:能力|効果)\s*[::]\s*(.+)$/);
    const flaM = line.match(/^(?:フレーバー|flavor)\s*[::]\s*(.+)$/i);
    if (effM && !effect) effect = stripWrappers(effM[1]!);
    else if (flaM && !flavor) flavor = stripWrappers(flaM[1]!);
  }
  if (!effect || !flavor) return null;
  // 長さサニティ
  if (effect.length < 8 || effect.length > 120) return null;
  if (flavor.length < 15 || flavor.length > 140) return null;
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
    const parsed = parseLLMOutput(raced);
    if (!parsed) return null;
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

