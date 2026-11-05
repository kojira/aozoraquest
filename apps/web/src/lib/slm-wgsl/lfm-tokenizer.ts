/**
 * LFM2.5-1.2B-JP の tokenizer (byte-level BPE) と chat template。
 * tokenizer は既存の依存 @huggingface/tokenizers をそのまま使う (試作で HF と id 列が一致した方式)。
 * chat template は HF の chat_template.jinja と同じ: `<|startoftext|>` + ChatML。think タグは付けず、内容は trim しない。
 */
import { Tokenizer } from '@huggingface/tokenizers';
import type { LLMInput } from '../local-llm';

/** slm.worker.ts が使う tokenizer の形 (sarashina の SpTokenizer と同じ)。 */
export interface SlmTokenizer {
  encode(text: string): number[];
  decode(ids: number[], opts?: { skip_special_tokens?: boolean }): string;
}

export function createLfmTokenizer(tokenizerJson: object): SlmTokenizer {
  const t = new Tokenizer(tokenizerJson, {});
  return {
    encode: (text) => t.encode(text, { add_special_tokens: false }).ids,
    decode: (ids, opts) => t.decode(ids, opts),
  };
}

/** prefill は assistant の書き出し (カードの「カード名:」など)。生成はその続きから始まる。 */
export function lfmChatPrompt(input: LLMInput, prefill = ''): string {
  let s = '<|startoftext|>';
  if (input.systemPrompt) s += `<|im_start|>system\n${input.systemPrompt}<|im_end|>\n`;
  for (const m of input.history) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  return `${s}<|im_start|>assistant\n${prefill}`;
}
