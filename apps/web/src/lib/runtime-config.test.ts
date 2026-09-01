import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@aozoraquest/types';
import { isAdminDid, isFlagEnabled, isUnderMaintenance } from './runtime-config';

function cfg(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return { ...DEFAULT_RUNTIME_CONFIG, ...overrides };
}

describe('isAdminDid', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('許可リストに含まれる DID は true', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:aaa, did:plc:bbb');
    expect(isAdminDid('did:plc:bbb')).toBe(true);
    expect(isAdminDid('did:plc:aaa')).toBe(true);
  });

  test('含まれない DID は false', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:aaa');
    expect(isAdminDid('did:plc:zzz')).toBe(false);
  });

  test('null / undefined / 空は false', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:aaa');
    expect(isAdminDid(null)).toBe(false);
    expect(isAdminDid(undefined)).toBe(false);
    expect(isAdminDid('')).toBe(false);
  });

  test('VITE_ADMIN_DIDS 未設定なら常に false', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', '');
    expect(isAdminDid('did:plc:aaa')).toBe(false);
  });

  test('前後空白・空要素は正規化して判定する', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', ' did:plc:aaa ,, did:plc:bbb ,');
    expect(isAdminDid('did:plc:aaa')).toBe(true);
    expect(isAdminDid('did:plc:bbb')).toBe(true);
    // 完全一致なので前後空白付きの引数は一致しない (session の did は正規化済み前提)
    expect(isAdminDid(' did:plc:aaa ')).toBe(false);
  });
});

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
  afterEach(() => vi.unstubAllEnvs());

  test('enabled=false なら false', () => {
    expect(isUnderMaintenance(cfg(), 'did:plc:a')).toBe(false);
  });

  test('enabled=true なら通常ユーザーは true', () => {
    const c = cfg({ maintenance: { enabled: true, updatedAt: 'x' } });
    expect(isUnderMaintenance(c, 'did:plc:a')).toBe(true);
  });

  test('未ログイン (did 無し) も止める', () => {
    const c = cfg({ maintenance: { enabled: true, updatedAt: 'x' } });
    expect(isUnderMaintenance(c, undefined)).toBe(true);
  });

  test('allowedDids に入っていれば false', () => {
    const c = cfg({ maintenance: { enabled: true, allowedDids: ['did:plc:vip'], updatedAt: 'x' } });
    expect(isUnderMaintenance(c, 'did:plc:vip')).toBe(false);
    expect(isUnderMaintenance(c, 'did:plc:other')).toBe(true);
  });

  test('管理者 (VITE_ADMIN_DIDS) は allowedDids に無くても常に通す — 締め出されると解除できない', () => {
    vi.stubEnv('VITE_ADMIN_DIDS', 'did:plc:primary, did:plc:second');
    const c = cfg({ maintenance: { enabled: true, updatedAt: 'x' } });
    expect(isUnderMaintenance(c, 'did:plc:primary')).toBe(false);
    expect(isUnderMaintenance(c, 'did:plc:second')).toBe(false);
    expect(isUnderMaintenance(c, 'did:plc:other')).toBe(true);
  });
});
