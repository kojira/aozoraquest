/**
 * カード用フレーバーテキスト生成。
 * TinySwallow (browser LLM) が使えればそちら、駄目ならハンドクラフト pool
 * から seed に基づいて抽選する。
 */

import type { Archetype, CogFunction, DiagnosisResult } from '@aozoraquest/core';
import { JOB_TAGLINES, JOBS_BY_ID, jobDisplayName } from '@aozoraquest/core';
import { getGenerator } from './generator';
import { pickFallbackFlavor } from './job-flavor-fallback';

const COG_LABEL: Record<CogFunction, string> = {
  Ni: '内向直観', Ne: '外向直観',
  Si: '内向感覚', Se: '外向感覚',
  Ti: '内向思考', Te: '外向思考',
  Fi: '内向感情', Fe: '外向感情',
};

export interface FlavorTextSource {
  kind: 'llm' | 'fallback';
  /** LLM 採用時の backend (webgpu/wasm) */
  backend?: 'webgpu' | 'wasm';
}

export interface FlavorTextResult {
  text: string;
  source: FlavorTextSource;
}

function buildPrompt(result: DiagnosisResult): { system: string; user: string } {
  const job = JOBS_BY_ID[result.archetype];
  const name = jobDisplayName(result.archetype);
  const tagline = JOB_TAGLINES[result.archetype];
  const dom = COG_LABEL[job.dominantFunction];
  const aux = COG_LABEL[job.auxiliaryFunction];
  const { atk, def, agi, int: i, luk } = result.rpgStats;
  const system = [
    'あなたは古い冒険者ギルドの登録証に添えるフレーバーテキストを書く詩人です。',
    '指定された気質を持つ人物を、40〜80 文字の日本語 1 文で詩的に描写してください。',
    '括弧 (「」『』《》) や説明文は使わず、地の文のみ。語尾は常体で。',
    '具体的なステータス数値や職業名はそのまま使わず、質感として織り込むこと。',
  ].join('\n');
  const user = `職業: ${name}
タグライン: ${tagline}
主要機能: ${dom} / ${aux}
ステータス: 攻 ${atk} / 守 ${def} / 速 ${agi} / 知 ${i} / 運 ${luk}`;
  return { system, user };
}

/** LLM 出力から括弧・引用符・余計な改行を削る。 */
function sanitize(raw: string): string {
  let t = raw.trim();
  // 先頭/末尾の「」『』「」"' を剥がす
  t = t.replace(/^[「『《"'“”]+/, '').replace(/[」』》"'“”]+$/, '');
  // 改行を 1 スペースに
  t = t.replace(/\s*\n\s*/g, ' ').trim();
  return t;
}

/** LLM 生成を試みる。失敗なら null。 */
async function generateWithLLM(result: DiagnosisResult, timeoutMs: number): Promise<FlavorTextResult | null> {
  const gen = getGenerator();
  try {
    await gen.load();
  } catch (e) {
    console.warn('[flavor] generator load failed', e);
    return null;
  }
  const { system, user } = buildPrompt(result);
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
  try {
    const fullPromise = gen.generate(messages);
    const raced = await Promise.race([
      fullPromise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('flavor LLM timeout')), timeoutMs)),
    ]);
    const text = sanitize(raced);
    if (!text || text.length < 15 || text.length > 200) return null;
    const source: FlavorTextSource = { kind: 'llm' };
    const backend = gen.getBackend();
    if (backend) source.backend = backend;
    return { text, source };
  } catch (e) {
    console.warn('[flavor] generation failed', e);
    return null;
  }
}

/**
 * フレーバーテキスト生成 (メイン API)。
 * LLM → fallback の順で試し、必ず 1 文返す。
 * seed は fallback のとき pool からの選択に使う (再生成で別の文を返したいとき
 * bump する)。
 */
export async function generateFlavor(
  result: DiagnosisResult,
  opts: { seed?: number; timeoutMs?: number } = {},
): Promise<FlavorTextResult> {
  const seed = opts.seed ?? Date.now();
  const timeoutMs = opts.timeoutMs ?? 45000;
  const llm = await generateWithLLM(result, timeoutMs);
  if (llm) return llm;
  return {
    text: pickFallbackFlavor(result.archetype, seed),
    source: { kind: 'fallback' },
  };
}

/** fallback だけを使いたい場合 (テスト / 強制保守モード)。 */
export function getFallbackFlavor(archetype: Archetype, seed: number): FlavorTextResult {
  return {
    text: pickFallbackFlavor(archetype, seed),
    source: { kind: 'fallback' },
  };
}
