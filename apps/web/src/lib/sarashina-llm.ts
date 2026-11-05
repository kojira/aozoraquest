/**
 * sarashina2.2-0.5b-instruct (int4、自前 WGSL、slm.worker.ts) を LocalLLM として実装。投稿翻訳専用。
 *
 * ブルスコン (LFM2.5、slm-llm.ts) を導入するまでの間、すでに sarashina を導入済みの端末の翻訳に使う (D-SLM-CARD-001 PR4 で削る)。
 * 新しく導入はしない。読み込みはキャッシュだけで、欠けていれば SlmNotInstalledError で未導入に戻す。
 * 1 回の生成は最初の改行か EOS で止まる (訳文の後に説明を書き足す癖への対策。複数段落は translate.ts が段落ごとに呼ぶ)。
 */

import type { LLMInput, LLMOptions, LocalLLM } from './local-llm';
import { createSlmClient, SlmNotInstalledError } from './slm-client';
import { isSlmEligible } from './slm-llm';
import { isSlmCached, SARASHINA_SOURCE } from './slm-wgsl/weights';

/** 1 回の出力上限。訳文 1 段落には十分で、暴走時の待ちを抑える。 */
const MAX_NEW_TOKENS = 200;

/** chat template (BOS なし、EOS `</s>`)。history は user / assistant の往復 (few-shot) をそのまま並べる。 */
export function sarashinaChatPrompt(input: LLMInput): string {
  let s = input.systemPrompt.trim() ? `<|system|>${input.systemPrompt.trim()}</s>` : '';
  for (const m of input.history) s += `<|${m.role}|>${m.content.trim()}</s>`;
  return `${s}<|assistant|>`;
}

const client = createSlmClient('sarashina');
let installed: boolean | null = null;

/**
 * キャッシュからモデルを GPU に載せ終えるまで待つ (翻訳の制限時間に読み込み時間を含めないため、translate.ts が生成の前に呼ぶ)。
 * ダウンロードはしない。キャッシュが欠けていれば SlmNotInstalledError (未導入に戻る)。
 */
export async function loadSarashina(): Promise<void> {
  try {
    await client.ensure(false);
  } catch (e) {
    if (e instanceof SlmNotInstalledError) installed = false;
    throw e;
  }
}

export async function isSarashinaInstalled(): Promise<boolean> {
  installed ??= await isSlmCached(SARASHINA_SOURCE);
  return installed;
}

async function generate(input: LLMInput, opts: LLMOptions = {}): Promise<string> {
  const last = input.history[input.history.length - 1];
  if (!last || last.role !== 'user') throw new Error('last history entry must be a user turn');
  await loadSarashina();
  return client.generate({
    prompt: sarashinaChatPrompt(input),
    maxNewTokens: Math.min(opts.maxNewTokens ?? MAX_NEW_TOKENS, MAX_NEW_TOKENS),
    temperature: opts.temperature ?? 0,
    repetitionPenalty: 1,
    stopAtNewline: true,
    signal: opts.signal,
  });
}

export const SARASHINA: LocalLLM = {
  id: 'sarashina-0.5b',
  label: '端末内 AI (sarashina)',
  purposes: ['translation'],
  async availability() {
    return (await isSlmEligible()) && (await isSarashinaInstalled());
  },
  generate,
};
