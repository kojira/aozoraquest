/**
 * Gemini Nano (Chrome built-in AI) を使った精霊応答生成。
 *
 * 1 turn = 1 session の create → promptStreaming → destroy パターン。
 * Bluskon は HISTORY_TURNS=6 程度なので Nano の 6144 token quota に収まる。
 *
 * 重要: Web Worker から呼べない (main thread のみ)。
 */

export interface SpiritGenInput {
  /** 空でも可 (admin プロンプト未設定時) */
  systemPrompt: string;
  /** 最後の要素は user role である前提 (= 今生成したい turn) */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface SpiritGenOptions {
  onToken?: (t: string) => void;
  temperature?: number;
  /** Nano API には直接渡せないので、出力長 (近似 token 数) で打ち切る soft stop */
  maxNewTokens?: number;
  signal?: AbortSignal;
}

/**
 * 日本語混じりテキストの token 数を雑に推定する。
 * GPT/Gemini 系の経験則で「日本語 1 文字 ≒ 1.0-1.5 token、英数字 1 文字 ≒ 0.3 token」。
 * 安全側 (短めで打ち切る) に倒して 1 文字 ≒ 0.7 token 換算。
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * 0.7);
}

export async function generateWithGeminiNano(
  input: SpiritGenInput,
  opts: SpiritGenOptions = {},
): Promise<string> {
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

  const createOpts: LanguageModelCreateOptions = {
    initialPrompts,
    temperature: opts.temperature ?? 0.8,
    topK: 3,
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
