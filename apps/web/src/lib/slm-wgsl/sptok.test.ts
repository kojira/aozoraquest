import { describe, expect, it } from 'vitest';
import { SpTokenizer, type UnigramJson } from './sptok';
import fixture from './sptok.fixture.json';

/**
 * 期待 id 列は HF の sarashina2.2-0.5b-instruct tokenizer (sentencepiece) の出力。
 * 語彙は 102400 件のうち、8 文の部分文字列になりうる piece と byte 片 <0xNN> と最小スコアの piece だけを
 * fixture に持つ (Viterbi の候補は部分文字列の piece だけなので、分割結果は全語彙と同じになる)。
 */
function tokenizer(): SpTokenizer {
  const vocab: [string, number][] = Array.from({ length: fixture.size }, () => ['', 0]);
  for (const [id, entry] of Object.entries(fixture.pieces)) vocab[Number(id)] = entry as [string, number];
  const j: UnigramJson = { added_tokens: fixture.added_tokens, model: { unk_id: fixture.unk_id, vocab } };
  return new SpTokenizer(j);
}

describe('SpTokenizer (sarashina)', () => {
  const tok = tokenizer();
  for (const c of fixture.cases) {
    it(`encodes like sentencepiece: ${JSON.stringify(c.text).slice(0, 40)}`, () => {
      expect(tok.encode(c.text)).toEqual(c.ids);
    });
  }

  it('decodes byte-fallback pieces back to the original text', () => {
    const c = fixture.cases.find((x) => x.text.includes('🎉'))!;
    expect(tok.decode(c.ids)).toBe(c.text);
  });
});
