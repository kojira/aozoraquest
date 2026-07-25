import { describe, it, expect } from 'vitest';
import { switchJobXp, jobLevelFromXp } from '../index.js';

/**
 * 転職しても職ごとのレベルが保持されること (#531)。
 *
 * 以前は転職のたびに `jobLevel.xp` が 0 に捨てられていた。戦闘由来の XP
 * (`GameState.jobXp`) は職ごとのキーで元から保持されていたので、
 * 「戦闘ぶんは戻るのに投稿ぶんは消える」という非対称になっていた。
 */
describe('switchJobXp (#531)', () => {
  const NOW = '2026-07-26T00:00:00Z';

  it('転職しても元の職の XP は消えず、保管庫に退避される', () => {
    const r = switchJobXp({ jobLevel: { archetype: 'warrior', xp: 5000, joinedAt: 'x' } }, 'sage', NOW);
    expect(r.jobLevel).toEqual({ archetype: 'sage', xp: 0, joinedAt: NOW });
    expect(r.jobXpByArchetype.warrior).toBe(5000);
  });

  it('過去に育てた職に戻ると、そのレベルから再開する', () => {
    // 戦士 5000 → 賢者へ → 賢者で 800 稼ぐ → 戦士へ戻る
    const a = switchJobXp({ jobLevel: { archetype: 'warrior', xp: 5000, joinedAt: 'x' } }, 'sage', NOW);
    const afterSage = { jobLevel: { ...a.jobLevel, xp: 800 }, jobXpByArchetype: a.jobXpByArchetype };
    const b = switchJobXp(afterSage, 'warrior', NOW);
    expect(b.jobLevel.xp).toBe(5000); // 戦士は元のレベルのまま
    expect(b.jobXpByArchetype.sage).toBe(800); // 賢者ぶんも退避されている
    expect(jobLevelFromXp(b.jobLevel.xp)).toBeGreaterThan(jobLevelFromXp(800));
  });

  it('現職ぶんは保管庫に入れない (jobLevel.xp との二重計上を防ぐ)', () => {
    const r = switchJobXp(
      { jobLevel: { archetype: 'warrior', xp: 100, joinedAt: 'x' }, jobXpByArchetype: { sage: 900 } },
      'sage',
      NOW,
    );
    expect(r.jobLevel.xp).toBe(900);
    expect(r.jobXpByArchetype.sage).toBeUndefined(); // 現職は保管庫から外れる
    expect(r.jobXpByArchetype.warrior).toBe(100);
  });

  it('同じ職への転職は XP を保つ (no-op)', () => {
    const r = switchJobXp({ jobLevel: { archetype: 'sage', xp: 1234, joinedAt: 'x' } }, 'sage', NOW);
    expect(r.jobLevel.xp).toBe(1234);
    expect(Object.keys(r.jobXpByArchetype)).toHaveLength(0);
  });

  it('保管庫を持たない既存ユーザーでも壊れない (後方互換)', () => {
    const r = switchJobXp({ jobLevel: { archetype: 'mage', xp: 42, joinedAt: 'x' } }, 'ninja', NOW);
    expect(r.jobLevel).toEqual({ archetype: 'ninja', xp: 0, joinedAt: NOW });
    expect(r.jobXpByArchetype.mage).toBe(42);
    // jobLevel すら無い (診断直後) でも落ちない
    expect(switchJobXp({}, 'poet', NOW).jobLevel).toEqual({ archetype: 'poet', xp: 0, joinedAt: NOW });
  });

  it('keepXp (管理ツールの LV 直接指定) でも退避はする', () => {
    const r = switchJobXp({ jobLevel: { archetype: 'warrior', xp: 5000, joinedAt: 'x' } }, 'sage', NOW, { keepXp: 300 });
    expect(r.jobLevel.xp).toBe(300); // 指定値が優先
    expect(r.jobXpByArchetype.warrior).toBe(5000); // 元の職は失われない
  });

  it('保管庫に大きい値があるとき現職の退避で減らさない', () => {
    // 異常系 (保管庫と jobLevel が食い違う) でも XP を削らない
    const r = switchJobXp(
      { jobLevel: { archetype: 'warrior', xp: 10, joinedAt: 'x' }, jobXpByArchetype: { warrior: 9999 } },
      'sage',
      NOW,
    );
    expect(r.jobXpByArchetype.warrior).toBe(9999);
  });
});
