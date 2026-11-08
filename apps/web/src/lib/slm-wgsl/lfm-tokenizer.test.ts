import { describe, expect, it } from 'vitest';
import { createLfmTokenizer, lfmChatPrompt } from './lfm-tokenizer';
import fixture from './lfm-tokenizer.fixture.json';

/**
 * 期待値は HF の LFM2.5-1.2B-JP-202606 (rev 52b8b44) の tokenizer と apply_chat_template の出力。
 * cases は一致確認 (parity) の 4 プロンプト (翻訳 JA→EN / EN→JA / ブルスコン / カード (c) の 1 件) で、greedy は HF int4 参照の生成 (EOS を除く)。
 * tokenizer は全語彙のうち、cases の pre-token の部分文字列になる vocab と merge だけを持つ部分集合 (分割は全語彙と同じになることを確認済み)。
 */
type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
const cases = fixture.cases as { messages: Msg[]; prefill: string; text: string; ids: number[]; greedy: number[]; greedyText: string }[];

describe('LFM tokenizer and chat template', () => {
  const tok = createLfmTokenizer(fixture.tokenizer);
  for (const c of cases) {
    const label = JSON.stringify(c.messages.at(-1)!.content).slice(0, 30);
    it(`chat template matches HF apply_chat_template: ${label}`, () => {
      const sys = c.messages[0]!.role === 'system' ? c.messages[0]!.content : '';
      const history = c.messages.filter((m) => m.role !== 'system') as { role: 'user' | 'assistant'; content: string }[];
      expect(lfmChatPrompt({ systemPrompt: sys, history }, c.prefill)).toBe(c.text);
    });
    it(`encodes like HF: ${label}`, () => {
      expect(tok.encode(c.text)).toEqual(c.ids);
    });
    it(`decodes the HF greedy ids: ${label}`, () => {
      expect(tok.decode(c.greedy, { skip_special_tokens: true })).toBe(c.greedyText);
    });
  }
});
