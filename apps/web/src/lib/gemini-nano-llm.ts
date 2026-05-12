/**
 * Gemini Nano (Chrome 148+ の LanguageModel API) を LocalLLM として実装。
 *
 * 1 turn = create → promptStreaming → destroy のパターン。
 * Bluskon の HISTORY_TURNS=6 程度でも Nano の 6144 token quota に収まる。
 *
 * 重要制約: Web Worker から呼べない (main thread のみ)。
 */

import type { LocalLLM, LLMInput, LLMOptions } from './local-llm';
import { detectGeminiNano } from './gemini-nano-availability';

/**
 * 出力 token 数の近似。Nano API には max_new_tokens 相当が無いので、
 * 文字数 × 0.7 (日本語混じりテキストの経験則) で soft cap する。厳密な
 * token 上限が必要なら session.measureInputUsage を使うべきだが、出力 token は
 * 事前計測できない API 仕様なのでこれで十分。
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.7);
}

async function generate(input: LLMInput, opts: LLMOptions = {}): Promise<string> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('LanguageModel is not available in this environment');
  }
  const last = input.history[input.history.length - 1];
  if (!last || last.role !== 'user') {
    throw new Error('last history entry must be a user turn');
  }

  const initialPrompts: LanguageModelMessage[] = [];
  if (input.systemPrompt) {
    initialPrompts.push({ role: 'system', content: input.systemPrompt });
  }
  for (const m of input.history.slice(0, -1)) {
    initialPrompts.push({ role: m.role, content: m.content });
  }

  // topK: 確率上位 K 個から sampling。低いほど決定的、高いほど多様。
  // 5 は Chrome デフォルト近辺で、温度 0.8 と組み合わせて自然な揺らぎが出る。
  const createOpts: LanguageModelCreateOptions = {
    initialPrompts,
    temperature: opts.temperature ?? 0.8,
    topK: 5,
    expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
    expectedOutputs: [{ type: 'text', languages: ['ja'] }],
  };
  if (opts.signal) createOpts.signal = opts.signal;
  const session = await LanguageModel.create(createOpts);

  try {
    const promptOpts: LanguageModelPromptOptions = {};
    if (opts.signal) promptOpts.signal = opts.signal;
    const stream = session.promptStreaming(last.content, promptOpts);
    const reader = stream.getReader();
    let acc = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = String(value ?? '');
      acc += chunk;
      opts.onToken?.(chunk);
      if (opts.maxNewTokens && estimateTokens(acc) >= opts.maxNewTokens) {
        await reader.cancel();
        break;
      }
    }
    return acc;
  } finally {
    session.destroy();
  }
}

export const GEMINI_NANO: LocalLLM = {
  id: 'gemini-nano',
  label: 'Gemini Nano (Chrome 内蔵 AI)',
  async availability() {
    return (await detectGeminiNano()) === 'available';
  },
  generate,
};
