import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosisResult } from '@aozoraquest/core';
import type { LLMInput, LLMOptions, LocalLLM } from './local-llm';
import { buildFourLinePrompt, FOURLINE_PREFILL, generateFourLineCard, parseFourLineCard } from './card-text-fourline';

/** LFM2.5 の実出力 (iPhone / デスクトップの card (c)。prefill の「カード名:」の続きから)。 */
const IPHONE_RAW = ' 薄明の観測者  \n能力名: 静寂の視界  \n説明: 早朝の静寂に潜む情報を読み取り、周囲の会話や投稿を一時的に遮断する。  \nフレーバー: 早朝の静寂は、まだ言葉を待つ思考の聖域——新たな知見が芽生える前に、ただ聞き取るのみ。';

describe('parseFourLineCard', () => {
  it('re-attaches the prefill and drops trailing spaces on each line', () => {
    expect(parseFourLineCard(IPHONE_RAW)).toEqual({
      cardName: '薄明の観測者',
      abilityName: '静寂の視界',
      description: '早朝の静寂に潜む情報を読み取り、周囲の会話や投稿を一時的に遮断する。',
      flavor: '早朝の静寂は、まだ言葉を待つ思考の聖域——新たな知見が芽生える前に、ただ聞き取るのみ。',
    });
  });

  it('cuts everything after the 4 lines (a 5th-line explanation)', () => {
    const raw = `${IPHONE_RAW}\nこのカードは、早朝の静けさを表現しています。\n説明: 上書きしない`;
    expect(parseFourLineCard(raw)?.description).toBe('早朝の静寂に潜む情報を読み取り、周囲の会話や投稿を一時的に遮断する。');
  });

  it('rejects forbidden game words in the description, but not 場合 / 職場', () => {
    const withDesc = (d: string) => ` 夜明けの番人\n能力名: 見張り\n説明: ${d}\nフレーバー: 夜が明けるまで、誰かの投稿をそっと見守っている者がいる。`;
    expect(parseFourLineCard(withDesc('対象の投稿を手札に戻し、通知を 1 時間止める。'))).toBeNull();
    expect(parseFourLineCard(withDesc('このクリーチャーが場に出たとき、いいねを 1 つ贈る。'))).toBeNull();
    expect(parseFourLineCard(withDesc('次のターン、タイムラインを静かにする効果を得る。'))).toBeNull();
    expect(parseFourLineCard(withDesc('通知が多い場合、タイムラインを 1 時間静かにする。'))).not.toBeNull();
    expect(parseFourLineCard(withDesc('職場の投稿にいいねするたび、通知を 1 つ減らす。'))).not.toBeNull();
  });

  it('rejects lengths out of range', () => {
    const card = (name: string, ab: string, d: string, f: string) => ` ${name}\n能力名: ${ab}\n説明: ${d}\nフレーバー: ${f}`;
    const d = '投稿にいいねが付くたび、通知を 1 つ静かにする。';
    const f = '夜が明けるまで、誰かの投稿をそっと見守っている者がいる。';
    expect(parseFourLineCard(card('夜', '見張り', d, f))).toBeNull(); // カード名 1 字
    expect(parseFourLineCard(card('夜明けの番人', 'とても長い能力名ですよね', d, f))).toBeNull(); // 能力名 11 字
    expect(parseFourLineCard(card('夜明けの番人', '見張り', '通知を止める。', f))).toBeNull(); // 説明 7 字
    expect(parseFourLineCard(card('夜明けの番人', '見張り', d, '短いフレーバー。'))).toBeNull(); // フレーバー 8 字
  });

  it('rejects 3+ Latin letters in a row and leaked tone labels', () => {
    const f = '夜が明けるまで、誰かの投稿をそっと見守っている者がいる。';
    expect(parseFourLineCard(` 夜明けの番人\n能力名: 見張り\n説明: 投稿に like が付くたび、通知を 1 つ静かにする。\nフレーバー: ${f}`)).toBeNull();
    expect(parseFourLineCard(` 夜明けの番人\n能力名: 見張り\n説明: 観察的：投稿にいいねが付くたび、通知を静かにする。\nフレーバー: ${f}`)).toBeNull();
  });

  it('rejects when a line is missing', () => {
    expect(parseFourLineCard(' 夜明けの番人\n能力名: 見張り\n説明: 投稿にいいねが付くたび、通知を 1 つ静かにする。')).toBeNull();
  });
});

const sage = { archetype: 'sage' } as DiagnosisResult;

describe('buildFourLinePrompt', () => {
  it('fixes type / mana / P/T in JS and ends with the user turn (2 few-shot turns before it)', () => {
    const p = buildFourLinePrompt({ archetype: 'sage', rarity: 'common', typeJa: 'クリーチャー', tone: 'positive', theme: '早朝の静寂', shots: 2 });
    expect(p.history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(p.history.at(-1)!.content).toBe('職業: 賢者\nカードタイプ: クリーチャー\nマナコスト: 青1\nパワー/タフネス: 1/1\n希少度: コモン\nトーン: 前向き\nテーマ: 早朝の静寂');
    const one = buildFourLinePrompt({ archetype: 'sage', rarity: 'rare', typeJa: 'インスタント', tone: 'ironic', theme: 'x', shots: 1 });
    expect(one.history).toHaveLength(3);
    expect(one.history.at(-1)!.content).not.toContain('パワー');
  });
});

describe('generateFourLineCard', () => {
  let outputs: string[];
  let calls: { input: LLMInput; opts: LLMOptions | undefined }[];
  const llm = (): LocalLLM => ({
    id: 'lfm2.5-1.2b-jp', label: 'x', cardPrompt: 'four-line',
    availability: async () => true,
    countPromptTokens: async () => 540,
    generate: async (input, opts) => { calls.push({ input, opts }); return outputs.shift() ?? ''; },
  });
  beforeEach(() => { outputs = []; calls = []; vi.spyOn(Math, 'random').mockReturnValue(0); });

  it('builds a CardText from the 4 lines and the JS-fixed values (creature: keywords and P/T)', async () => {
    outputs = [IPHONE_RAW];
    const c = (await generateFourLineCard(llm(), sage, 'common', 1))!;
    expect(c.cardName).toBe('薄明の観測者');
    expect(c.type).toBe('creature');
    expect(c.manaCost).toEqual({ U: 1 });
    expect(c.keywords).toEqual(['警戒']);
    expect([c.power, c.toughness]).toEqual([1, 1]);
    expect(c.effect).toEqual({ name: '静寂の視界', description: '早朝の静寂に潜む情報を読み取り、周囲の会話や投稿を一時的に遮断する。' });
    expect(c.source).toEqual({ kind: 'llm', backend: 'lfm2.5-1.2b-jp' });
    expect(calls[0]!.opts).toMatchObject({ prefill: FOURLINE_PREFILL, maxNewTokens: 160, temperature: 0.95, repetitionPenalty: 1.1 });
  });

  it('retries up to 3 times, then gives up with null (the caller falls back)', async () => {
    outputs = ['だめ', 'だめ', 'だめ', IPHONE_RAW];
    expect(await generateFourLineCard(llm(), sage, 'common', 1)).toBeNull();
    expect(calls).toHaveLength(3);
  });

  it('succeeds on a later attempt', async () => {
    outputs = ['だめ', IPHONE_RAW];
    const c = await generateFourLineCard(llm(), sage, 'common', 1);
    expect(calls).toHaveLength(2);
    expect(c?.source.kind).toBe('llm');
  });

  it('drops to 1 few-shot turn when the prompt would not fit in ctx 1024 - 160', async () => {
    outputs = [IPHONE_RAW];
    const big = { ...llm(), countPromptTokens: async (input: LLMInput) => (input.history.length > 3 ? 900 : 600) };
    await generateFourLineCard(big, sage, 'common', 1);
    expect(calls[0]!.input.history).toHaveLength(3);
  });
});
