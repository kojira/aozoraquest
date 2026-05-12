/**
 * 精霊ブルスコン専用の生成エントリ。
 *
 * 内部で 2 つの backend を切り替える:
 *  - 'gemini-nano':  Chrome 148+ の LanguageModel API (main thread)
 *  - 'tinyswallow': 既存の TinySwallow worker (generator.ts)
 *
 * 切替条件:
 *  1. localStorage の useGeminiNano が false → 常に TinySwallow
 *  2. true で Nano availability が 'available' → Nano
 *  3. それ以外 (downloadable/downloading/unavailable) → TinySwallow に silent fallback
 *  4. Nano runtime で reject → catch して TinySwallow にも fallback
 *
 * caller (spirit.tsx / summoning-ritual.tsx) は backend を意識せず
 * generateSpirit({systemPrompt, history}, opts) を呼ぶだけ。
 *
 * 他の caller (flavor-text.ts / translate.ts) は getGenerator() のまま
 * (Bluskon スコープ外、現状品質維持)。
 */

import { getGenerator, type ChatMessage } from './generator';
import { detectGeminiNano } from './gemini-nano-availability';
import { generateWithGeminiNano, type SpiritGenInput, type SpiritGenOptions } from './gemini-nano-backend';
import { loadUseGeminiNano } from './spirit-prefs';

export type SpiritBackend = 'gemini-nano' | 'tinyswallow';

export interface SpiritGenResult {
  text: string;
  backend: SpiritBackend;
  /** Nano を試して失敗し TinySwallow に fallback したとき、その理由を残す。
   *  caller は UI で「Nano エラーで TinySwallow に切替」と見せられる。 */
  fallbackReason?: string;
}

export async function pickSpiritBackend(): Promise<SpiritBackend> {
  if (!loadUseGeminiNano()) return 'tinyswallow';
  const status = await detectGeminiNano();
  return status === 'available' ? 'gemini-nano' : 'tinyswallow';
}

export async function generateSpirit(
  input: SpiritGenInput,
  opts: SpiritGenOptions = {},
): Promise<SpiritGenResult> {
  const backend = await pickSpiritBackend();
  let fallbackReason: string | undefined;

  if (backend === 'gemini-nano') {
    try {
      const text = await generateWithGeminiNano(input, opts);
      return { text, backend: 'gemini-nano' };
    } catch (e) {
      fallbackReason = (e as Error)?.message ?? String(e);
      console.warn('[spirit] Gemini Nano failed, falling back to TinySwallow:', e);
    }
  }

  const messages = buildTinySwallowMessages(input);
  const g = getGenerator();
  const tsOpts: { onToken?: (t: string) => void; temperature?: number; maxNewTokens?: number } = {};
  if (opts.onToken) tsOpts.onToken = opts.onToken;
  if (opts.temperature !== undefined) tsOpts.temperature = opts.temperature;
  if (opts.maxNewTokens !== undefined) tsOpts.maxNewTokens = opts.maxNewTokens;
  const text = await g.generate(messages, tsOpts);
  return fallbackReason
    ? { text, backend: 'tinyswallow', fallbackReason }
    : { text, backend: 'tinyswallow' };
}

/**
 * TinySwallow は system role を ~22% しか守らない一方、最後の user message に
 * 指示を prepend すると ~58% 守るのが bench で確認済 (docs/bench/...) なので、
 * systemPrompt を最後の user message の頭に結合する。
 */
function buildTinySwallowMessages(input: SpiritGenInput): ChatMessage[] {
  return input.history.map((m, i) => {
    const isLastUser = m.role === 'user' && i === input.history.length - 1;
    const content =
      isLastUser && input.systemPrompt ? `${input.systemPrompt}\n\n${m.content}` : m.content;
    return { role: m.role, content };
  });
}
