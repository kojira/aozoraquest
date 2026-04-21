import { describe, expect, test } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { isBanned, isFlagEnabled, isUnderMaintenance } from './runtime-config';

function cfg(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...DEFAULT_RUNTIME_CONFIG, ...overrides };
}

describe('isFlagEnabled', () => {
  test('未定義フラグは false', () => {
    expect(isFlagEnabled('unknown', cfg(), 'did:plc:a')).toBe(false);
  });

  test('enabled=false は常に false', () => {
    const c = cfg({ flags: { x: { enabled: false, rollout: 100, description: '' } } });
    expect(isFlagEnabled('x', c, 'did:plc:a')).toBe(false);
  });

  test('rollout=100 は全員 true', () => {
    const c = cfg({ flags: { x: { enabled: true, rollout: 100, description: '' } } });
    expect(isFlagEnabled('x', c, 'did:plc:a')).toBe(true);
    expect(isFlagEnabled('x', c, 'did:plc:zzzz')).toBe(true);
  });

  test('rollout=0 は常に false', () => {
    const c = cfg({ flags: { x: { enabled: true, rollout: 0, description: '' } } });
    expect(isFlagEnabled('x', c, 'did:plc:a')).toBe(false);
  });

  test('同じ flag+did は決定的', () => {
    const c = cfg({ flags: { x: { enabled: true, rollout: 50, description: '' } } });
    const a = isFlagEnabled('x', c, 'did:plc:sample');
    const b = isFlagEnabled('x', c, 'did:plc:sample');
    expect(a).toBe(b);
  });

  test('rollout=50 は概ね半分', () => {
    const c = cfg({ flags: { x: { enabled: true, rollout: 50, description: '' } } });
    let on = 0;
    for (let i = 0; i < 1000; i++) {
      if (isFlagEnabled('x', c, `did:plc:${i}`)) on++;
    }
    expect(on).toBeGreaterThan(400);
    expect(on).toBeLessThan(600);
  });

  test('did 未指定かつ rollout<100 は false', () => {
    const c = cfg({ flags: { x: { enabled: true, rollout: 50, description: '' } } });
    expect(isFlagEnabled('x', c, undefined)).toBe(false);
  });
});

describe('isUnderMaintenance', () => {
  test('enabled=false なら false', () => {
    expect(isUnderMaintenance(cfg(), 'did:plc:a')).toBe(false);
  });

  test('enabled=true なら通常ユーザーは true', () => {
    const c = cfg({ maintenance: { enabled: true, updatedAt: 'x' } });
    expect(isUnderMaintenance(c, 'did:plc:a')).toBe(true);
  });

  test('allowedDids に入っていれば false', () => {
    const c = cfg({ maintenance: { enabled: true, allowedDids: ['did:plc:admin'], updatedAt: 'x' } });
    expect(isUnderMaintenance(c, 'did:plc:admin')).toBe(false);
    expect(isUnderMaintenance(c, 'did:plc:other')).toBe(true);
  });
});

describe('isBanned', () => {
  test('空配列では false', () => {
    expect(isBanned(cfg(), 'did:plc:a')).toBe(false);
  });

  test('入っていれば true', () => {
    const c = cfg({ bans: ['did:plc:bad'] });
    expect(isBanned(c, 'did:plc:bad')).toBe(true);
    expect(isBanned(c, 'did:plc:good')).toBe(false);
  });
});
