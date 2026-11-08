import { describe, expect, it } from 'vitest';
import { cleanSlmParagraph, SLM_TRANSLATE_SYSTEM, slmTranslateInput, splitParagraphs } from './slm-translate';
import { lfmChatPrompt } from './slm-wgsl/lfm-tokenizer';

describe('LFM translate prompt (D-SLM-CARD-001 §1 の採用案)', () => {
  it('is a 1-line system prompt and the paragraph, with no few-shot turns', () => {
    const input = slmTranslateInput('Coffee first, then we talk about deadlines.');
    expect(input.systemPrompt).toBe(SLM_TRANSLATE_SYSTEM);
    expect(input.history).toEqual([{ role: 'user', content: 'Coffee first, then we talk about deadlines.' }]);
    expect(lfmChatPrompt(input)).toBe(
      `<|startoftext|><|im_start|>system\n${SLM_TRANSLATE_SYSTEM}<|im_end|>\n<|im_start|>user\nCoffee first, then we talk about deadlines.<|im_end|>\n<|im_start|>assistant\n`,
    );
  });

  it('asks for casual Japanese without additions', () => {
    expect(SLM_TRANSLATE_SYSTEM).toBe('英語の SNS 投稿を日本語に訳す。友達に話すくだけた口調 (〜だよ、〜した) にし、です・ます調は使わない。訳文だけを 1 行で出す。原文に無いことは足さない。説明・注釈・引用符は書かない。');
  });
});

describe('cleanSlmParagraph', () => {
  it('keeps only the first line and strips quotes around the whole line', () => {
    expect(cleanSlmParagraph('「宇宙に関する素晴らしい本を読み終えたよ！」\n(訳注)')).toBe('宇宙に関する素晴らしい本を読み終えたよ！');
    expect(cleanSlmParagraph('  マラソンメダル取ったよ！  脚は死んだけど ')).toBe('マラソンメダル取ったよ！ 脚は死んだけど');
  });
});

describe('splitParagraphs', () => {
  it('splits paragraphs on blank lines only', () => {
    expect(splitParagraphs('Line one\nstill one\n\n  Two  ')).toEqual(['Line one still one', 'Two']);
  });
});
