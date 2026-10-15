import { describe, it, expect } from 'vitest';
import {
  setQuestActionableCount,
  subscribeQuestActionable,
  getQuestActionableSnapshot,
} from './quest-actionable';

describe('quest-actionable store', () => {
  it('set した値が snapshot に反映される', () => {
    setQuestActionableCount(3);
    expect(getQuestActionableSnapshot()).toBe(3);
    setQuestActionableCount(0);
    expect(getQuestActionableSnapshot()).toBe(0);
  });

  it('値が変わると購読者へ通知する', () => {
    setQuestActionableCount(0);
    let calls = 0;
    const off = subscribeQuestActionable(() => { calls += 1; });
    setQuestActionableCount(2);
    expect(calls).toBe(1);
    expect(getQuestActionableSnapshot()).toBe(2);
    off();
  });

  it('同値の set では通知しない (同値ガード)', () => {
    setQuestActionableCount(5);
    let calls = 0;
    const off = subscribeQuestActionable(() => { calls += 1; });
    setQuestActionableCount(5); // 同値 → 通知なし
    expect(calls).toBe(0);
    setQuestActionableCount(6); // 変化 → 通知
    expect(calls).toBe(1);
    off();
  });

  it('解除後は通知が来ない', () => {
    setQuestActionableCount(0);
    let calls = 0;
    const off = subscribeQuestActionable(() => { calls += 1; });
    off();
    setQuestActionableCount(9);
    expect(calls).toBe(0);
  });
});
