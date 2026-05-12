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
 * 出力を打ち切る soft cap の長さ推定。厳密な token count ではなく
 * 「TinySwallow に同じ maxNewTokens を渡したときと概ね同じ文字数で止める」
 * ための換算係数。日本語 1 文字 ≒ 1.0-1.5 token、英数字 1 文字 ≒ 0.3 token
 * が経験則だが、Bluskon は admin の maxNewTokens (default 60) で
 * 「TinySwallow が出していたのと同じくらいの長さ」を期待する運用なので、
 * 0.7 換算で文字数を伸ばす方向に倒している (= ハード上限ではない)。
 *
 * 厳密に token quota を守りたければ session.measureInputUsage() を使うべき
 * だが、出力 token は事前計測できない (Nano API 制約) ため近似で十分。
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

  // topK: 確率上位 K 個から sampling。低いほど決定的 (毎回同じ言い回し)、
  // 高いほど多様。admin が「詩的に」「優しい言葉で」のように曖昧な指示を
  // 出している場合は多様性側に倒した方が応答が硬くならない。5 は Chrome の
  // デフォルト近辺で、温度 0.8 と組み合わせて自然な揺らぎが出る値。
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
