/**
 * カード生成パイプラインの純粋関数テスト。LLM 呼び出しは含めず、
 * parser / 抽選ヘルパだけを検証する。プロンプト変更時の回帰防止が目的。
 */
import { describe, expect, test } from 'vitest';
import {
  parseManaCostString_TEST as parseManaCostString,
  parseKeywordsString_TEST as parseKeywordsString,
  parseStatNumber_TEST as parseStatNumber,
  parseCardTypeString_TEST as parseCardTypeString,
  pickStructure_TEST as pickStructure,
  pickEffectInspirations_TEST as pickEffectInspirations,
  pickCardType_TEST as pickCardType,
} from './flavor-text';

describe('parseManaCostString', () => {
  test('「なし」「none」「0」「-」は空コスト', () => {
    expect(parseManaCostString('なし')).toEqual({});
    expect(parseManaCostString('無し')).toEqual({});
    expect(parseManaCostString('none')).toEqual({});
    expect(parseManaCostString('0')).toEqual({});
    expect(parseManaCostString('-')).toEqual({});
    expect(parseManaCostString('')).toEqual({});
  });

  test('色名+数字 (日本語色名)', () => {
    expect(parseManaCostString('赤1')).toEqual({ R: 1 });
    expect(parseManaCostString('白2')).toEqual({ W: 2 });
    expect(parseManaCostString('青3')).toEqual({ U: 3 });
    expect(parseManaCostString('黒1')).toEqual({ B: 1 });
    expect(parseManaCostString('緑1')).toEqual({ G: 1 });
  });

  test('1 文字色記号 + 数字 (アルファベット)', () => {
    expect(parseManaCostString('R1')).toEqual({ R: 1 });
    expect(parseManaCostString('U2')).toEqual({ U: 2 });
  });

  test('色マナ重ね (赤赤 = R:2)', () => {
    expect(parseManaCostString('赤赤')).toEqual({ R: 2 });
    expect(parseManaCostString('白白白')).toEqual({ W: 3 });
  });

  test('generic と色マナの混在', () => {
    expect(parseManaCostString('赤1 generic2')).toEqual({ R: 1, generic: 2 });
    expect(parseManaCostString('青1 generic1')).toEqual({ U: 1, generic: 1 });
  });

  test('bare 数字は generic 扱い', () => {
    expect(parseManaCostString('3')).toEqual({ generic: 3 });
    expect(parseManaCostString('赤1 2')).toEqual({ R: 1, generic: 2 });
  });

  test('generic 単独表記', () => {
    expect(parseManaCostString('generic3')).toEqual({ generic: 3 });
    expect(parseManaCostString('無3')).toEqual({ generic: 3 });
  });

  test('色文字以外のトークンは無視', () => {
    // 色 1 文字 (W/U/B/R/G/白/青/黒/赤/緑) 以外で数字でもないものは無視。
    expect(parseManaCostString('赤1 xyz')).toEqual({ R: 1 });
    expect(parseManaCostString('青1 @@@')).toEqual({ U: 1 });
  });
});

describe('parseKeywordsString', () => {
  test('「なし」は空配列', () => {
    expect(parseKeywordsString('なし')).toEqual([]);
    expect(parseKeywordsString('無し')).toEqual([]);
    expect(parseKeywordsString('')).toEqual([]);
  });

  test('カンマ区切りで複数キーワード', () => {
    expect(parseKeywordsString('飛行, 警戒')).toEqual(['飛行', '警戒']);
    expect(parseKeywordsString('飛行,警戒,トランプル')).toEqual(['飛行', '警戒', 'トランプル']);
  });

  test('日本語カンマ・全角スペース・スラッシュも区切り', () => {
    expect(parseKeywordsString('飛行、警戒')).toEqual(['飛行', '警戒']);
    expect(parseKeywordsString('飛行 警戒')).toEqual(['飛行', '警戒']);
    expect(parseKeywordsString('飛行/警戒')).toEqual(['飛行', '警戒']);
  });

  test('未知のキーワードは捨てる (ホワイトリスト方式)', () => {
    expect(parseKeywordsString('飛行, スーパー必殺技, 警戒')).toEqual(['飛行', '警戒']);
    expect(parseKeywordsString('架空キーワード')).toEqual([]);
  });

  test('3 個まで (それ以上は捨てる)', () => {
    const result = parseKeywordsString('飛行, 警戒, トランプル, 接死, 速攻');
    expect(result.length).toBe(3);
    expect(result).toEqual(['飛行', '警戒', 'トランプル']);
  });

  test('重複は除外', () => {
    expect(parseKeywordsString('飛行, 飛行, 警戒')).toEqual(['飛行', '警戒']);
  });
});

describe('parseStatNumber', () => {
  test('1-7 の整数を返す', () => {
    expect(parseStatNumber('1')).toBe(1);
    expect(parseStatNumber('4')).toBe(4);
    expect(parseStatNumber('7')).toBe(7);
  });

  test('0 は不許可 (undefined)', () => {
    expect(parseStatNumber('0')).toBeUndefined();
  });

  test('8 以上は不許可 (undefined)', () => {
    expect(parseStatNumber('8')).toBeUndefined();
    expect(parseStatNumber('20')).toBeUndefined();
    expect(parseStatNumber('100')).toBeUndefined();
  });

  test('「なし」は undefined', () => {
    expect(parseStatNumber('なし')).toBeUndefined();
    expect(parseStatNumber('無し')).toBeUndefined();
    expect(parseStatNumber('')).toBeUndefined();
  });

  test('文字列に混ざった数字も拾う', () => {
    // 「3 / 4」のように出されても 3 だけ拾えれば OK
    expect(parseStatNumber('3 / 4')).toBe(3);
    expect(parseStatNumber('パワー 5')).toBe(5);
  });

  test('数字なしの文字列は undefined', () => {
    expect(parseStatNumber('abc')).toBeUndefined();
  });
});

describe('parseCardTypeString', () => {
  test('日本語タイプ名を CardType に変換', () => {
    expect(parseCardTypeString('クリーチャー')).toBe('creature');
    expect(parseCardTypeString('インスタント')).toBe('instant');
    expect(parseCardTypeString('ソーサリー')).toBe('sorcery');
    expect(parseCardTypeString('アーティファクト')).toBe('artifact');
  });

  test('英語タイプ名も受ける', () => {
    expect(parseCardTypeString('creature')).toBe('creature');
    expect(parseCardTypeString('Instant')).toBe('instant');
    expect(parseCardTypeString('SORCERY')).toBe('sorcery');
  });

  test('部分マッチ (文中にタイプ名を含む)', () => {
    expect(parseCardTypeString('カードタイプ: クリーチャー')).toBe('creature');
  });

  test('未知のタイプは null', () => {
    expect(parseCardTypeString('エンチャント')).toBeNull();
    expect(parseCardTypeString('foo')).toBeNull();
    expect(parseCardTypeString('')).toBeNull();
  });
});

describe('pickStructure', () => {
  test('type 指定なしは全 12 構造から抽選 (id が known set)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) ids.add(pickStructure().id);
    // 200 回引けば 12 構造のほとんどが出るはず
    expect(ids.size).toBeGreaterThanOrEqual(8);
  });

  test('creature 用フィルタが効く (instant/sorcery 専用構造を返さない)', () => {
    // creature 専用に許可されていない構造 (replacement, sacrifice, all-affect, target-curse) は出ない
    const forbidden = new Set(['replacement', 'sacrifice', 'all-affect', 'target-curse']);
    for (let i = 0; i < 100; i++) {
      const s = pickStructure('creature');
      expect(forbidden.has(s.id)).toBe(false);
    }
  });

  test('instant 用フィルタ', () => {
    // instant では場に居続けるカード型の構造 (etb, triggered, static-buff, activated-tap, activated-mana) が出ない
    const forbidden = new Set(['etb', 'triggered', 'static-buff', 'activated-tap', 'activated-mana']);
    for (let i = 0; i < 100; i++) {
      const s = pickStructure('instant');
      expect(forbidden.has(s.id)).toBe(false);
    }
  });

  test('artifact 用フィルタ', () => {
    // artifact は creature 専用構造 (etb, triggered, choice, drawback, replacement, sacrifice) を返さない
    const forbidden = new Set(['etb', 'triggered', 'choice', 'drawback', 'replacement', 'sacrifice']);
    for (let i = 0; i < 100; i++) {
      const s = pickStructure('artifact');
      expect(forbidden.has(s.id)).toBe(false);
    }
  });
});

describe('pickEffectInspirations', () => {
  test('指定した構造のサンプルを n 件返す', () => {
    const items = pickEffectInspirations('etb', 3);
    expect(items.length).toBe(3);
    items.forEach((s) => expect(typeof s).toBe('string'));
  });

  test('n が pool より多くても安全 (pool 全長で頭打ち)', () => {
    const items = pickEffectInspirations('choice', 100);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(100);
    // 重複しない (Fisher-Yates 部分シャッフル)
    expect(new Set(items).size).toBe(items.length);
  });

  test('未知の構造 ID は空配列', () => {
    expect(pickEffectInspirations('unknown-structure', 3)).toEqual([]);
  });

  test('n=0 は空配列', () => {
    expect(pickEffectInspirations('etb', 0)).toEqual([]);
  });
});

describe('pickCardType (分布)', () => {
  test('多数回引いて creature が過半数、artifact も出る (重み付き抽選)', () => {
    const counts: Record<string, number> = {
      'クリーチャー': 0, 'インスタント': 0, 'ソーサリー': 0, 'アーティファクト': 0,
    };
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const t = pickCardType();
      counts[t] = (counts[t] ?? 0) + 1;
    }
    // 期待: creature 55%, artifact 20%, sorcery 13%, instant 12%。
    // 2000 回なら ±5% の揺らぎは許容。
    expect(counts['クリーチャー'] ?? 0).toBeGreaterThan(N * 0.45);
    expect(counts['クリーチャー'] ?? 0).toBeLessThan(N * 0.65);
    expect(counts['アーティファクト'] ?? 0).toBeGreaterThan(N * 0.1);
    expect(counts['アーティファクト'] ?? 0).toBeLessThan(N * 0.3);
    // 全カテゴリが少なくとも 1 回は出る
    expect(counts['インスタント']).toBeGreaterThan(0);
    expect(counts['ソーサリー']).toBeGreaterThan(0);
  });
});
