import { describe, expect, test } from 'vitest';
import { splitSentences } from './split-sentences';

// D-TTS-001 follow-up: each line is synthesized sentence by sentence (the owner heard 「Bluesky」 read correctly this way).
describe('splitSentences', () => {
  test('splits after 。！？ (and ASCII ! ?), keeping the mark with its sentence', () => {
    expect(splitSentences('わたしもBluesky。このギルドの受付だよ。まちおさにその手紙を見せてあげて。きっと話を聞いてくれる。')).toEqual([
      'わたしもBluesky。', 'このギルドの受付だよ。', 'まちおさにその手紙を見せてあげて。', 'きっと話を聞いてくれる。',
    ]);
    expect(splitSentences('いらっしゃい！　ふたばのわたしから聞いてるよ、手紙を持った旅人さん。')).toEqual([
      'いらっしゃい！', 'ふたばのわたしから聞いてるよ、手紙を持った旅人さん。',
    ]);
    expect(splitSentences('ほんと?! うん!')).toEqual(['ほんと?!', 'うん!']);
  });
  test('a line without sentence marks is one piece; blank input is none', () => {
    expect(splitSentences('  ようこそ、旅人さん  ')).toEqual(['ようこそ、旅人さん']);
    expect(splitSentences('   ')).toEqual([]);
  });
  test('closing brackets and quotes stay with the sentence they close', () => {
    expect(splitSentences('……やったね！」ほんとうに。')).toEqual(['……やったね！」', 'ほんとうに。']);
    expect(splitSentences('「またね。」』そして')).toEqual(['「またね。」』', 'そして']);
  });
});
