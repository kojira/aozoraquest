/**
 * シナリオのお知らせに付ける演出 (D-STORY-007)。閉じた列挙だけを受け付け、
 * 描画先 (お知らせ) の無い演出は保存させない。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setScenario, scenarioEvents, type ScenarioEvent } from '../scenario.js';

const base: ScenarioEvent = { id: 'e1', title: '引き', when: [], setFlags: ['f1'], notice: 'そらが ひかった' };
const bad = (patch: Record<string, unknown>) => () => setScenario([{ ...base, ...patch } as ScenarioEvent]);

afterEach(() => setScenario(null));

describe('validateScenario: effects', () => {
  it('列挙どおりの演出は受理し、setScenario 後も保持する', () => {
    setScenario([{ ...base, effects: [{ kind: 'tint', color: 'red' }, { kind: 'flash', color: 'white' }, { kind: 'fade', to: 'black' }, { kind: 'silhouette', show: true }] }]);
    expect(scenarioEvents()[0]!.effects).toEqual([{ kind: 'tint', color: 'red' }, { kind: 'flash', color: 'white' }, { kind: 'fade', to: 'black' }, { kind: 'silhouette', show: true }]);
  });
  it('未知の kind を拒否する', () => {
    expect(bad({ effects: [{ kind: 'shake' }] })).toThrow(/演出が不正/);
  });
  it('列挙外の色・余分なキー (任意画像) を拒否する', () => {
    expect(bad({ effects: [{ kind: 'tint', color: 'blue' }] })).toThrow(/演出が不正/);
    expect(bad({ effects: [{ kind: 'silhouette', show: true, src: 'x.png' }] })).toThrow(/演出が不正/);
  });
  it('5 件以上を拒否する', () => {
    expect(bad({ effects: Array.from({ length: 5 }, () => ({ kind: 'tint', color: 'red' })) })).toThrow(/演出が不正/);
  });
  it('配列でない演出を拒否する', () => {
    expect(bad({ effects: { kind: 'tint', color: 'red' } })).toThrow(/演出が不正/);
  });
  it('お知らせの無い演出を拒否する', () => {
    expect(bad({ notice: undefined, effects: [{ kind: 'tint', color: 'red' }] })).toThrow(/お知らせが必要/);
  });
});
