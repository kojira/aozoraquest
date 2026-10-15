import { describe, expect, it } from 'vitest';
import { cleanSarashinaParagraph, sarashinaTranslateInput, splitParagraphs } from './sarashina-translate';
import { sarashinaChatPrompt } from './sarashina-llm';

describe('cleanSarashinaParagraph', () => {
  it('drops glosses in parentheses that contain Latin letters (actual 0.5b outputs)', () => {
    expect(cleanSarashinaParagraph('ついにmarathon（marathonはマラソンの意味）のメダル取った。'))
      .toBe('ついにmarathonのメダル取った。');
    expect(cleanSarashinaParagraph('まずはコーヒー。その後、deadlines（deadline：期限）について話すよ。'))
      .toBe('まずはコーヒー。その後、deadlinesについて話すよ。');
  });

  it('removes nested and unclosed glosses', () => {
    expect(cleanSarashinaParagraph('脚は dead（ deadは「 dead end（ dead end：直角）」の意味）だけど嬉しい。')).toBe('脚は deadだけど嬉しい。');
    expect(cleanSarashinaParagraph('メダル取った。 legs は dead（ deadは「 dead end」のように')).toBe('メダル取った。 legs は dead');
  });

  it('keeps Japanese-only parentheses and cuts after the first line', () => {
    expect(cleanSarashinaParagraph('今日は（たぶん）晴れ。\n---\n（訳：今日は晴れ）')).toBe('今日は（たぶん）晴れ。');
  });

  it('strips quotes wrapping the whole line', () => {
    expect(cleanSarashinaParagraph('「新しいカフェ見つけた！」')).toBe('新しいカフェ見つけた！');
  });
});

describe('sarashina translate prompt', () => {
  it('puts system, 4 few-shot turns and the paragraph into the sarashina chat template', () => {
    const p = sarashinaChatPrompt(sarashinaTranslateInput('Coffee first.'));
    expect(p.startsWith('<|system|>英語の SNS 投稿を')).toBe(true);
    expect(p.match(/<\|assistant\|>/g)).toHaveLength(5);
    expect(p.endsWith('<|user|>Coffee first.</s><|assistant|>')).toBe(true);
  });

  it('splits paragraphs on blank lines only', () => {
    expect(splitParagraphs('Line one\nstill one\n\n  Two  ')).toEqual(['Line one still one', 'Two']);
  });
});
