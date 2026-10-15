import { describe, expect, it } from 'vitest';
import { scenarioMessagesOf } from './world-server';

/** 戦闘決着・報告のお知らせは演出ごと保持する (D-STORY-007)。旧 edge の文字列だけでも出す。 */
describe('scenarioMessagesOf', () => {
  it('新 edge の scenarioMessages を演出ごと優先する', () => {
    expect(scenarioMessagesOf([{ text: 'あかい', effects: [{ kind: 'tint', color: 'red' }] }], ['あかい']))
      .toEqual([{ text: 'あかい', effects: [{ kind: 'tint', color: 'red' }] }]);
  });
  it('旧 edge の notices だけなら演出なしの行にする', () => {
    expect(scenarioMessagesOf(undefined, ['お知らせ'])).toEqual([{ text: 'お知らせ' }]);
    expect(scenarioMessagesOf(undefined, undefined)).toEqual([]);
  });
});
