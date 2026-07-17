import { describe, expect, test, vi } from 'vitest';
import { worldOverlay } from '@aozoraquest/core';
import { loadWorldState } from './world-state';

function agentWithGetRecord(impl: () => Promise<unknown>): any {
  return { com: { atproto: { repo: { getRecord: vi.fn(impl) } } } };
}

describe('loadWorldState', () => {
  test('レコードがあれば wrap した座標を返す', async () => {
    const agent = agentWithGetRecord(async () => ({
      data: { value: { x: 1030, y: -2, updatedAt: '2026-07-17T00:00:00.000Z' } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    expect(s.x).toBe(6); // 1030 mod 1024
    expect(s.y).toBe(1022);
  });

  test('レコード未作成 (RecordNotFound) は spawn を返す', async () => {
    const agent = agentWithGetRecord(async () => {
      const e = new Error('Could not locate record') as Error & { error?: string };
      e.error = 'RecordNotFound';
      throw e;
    });
    const s = await loadWorldState(agent, 'did:test');
    const spawn = worldOverlay().spawn;
    expect(s.x).toBe(spawn.x);
    expect(s.y).toBe(spawn.y);
  });

  test('一時的な読み込み失敗は throw する (spawn に倒すと位置の上書き事故になる)', async () => {
    const agent = agentWithGetRecord(async () => {
      throw new Error('network down');
    });
    await expect(loadWorldState(agent, 'did:test')).rejects.toThrow();
  });

  test('壊れたレコード (x/y が数値でない) は spawn を返す', async () => {
    const agent = agentWithGetRecord(async () => ({ data: { value: { x: 'a', y: null } } }));
    const s = await loadWorldState(agent, 'did:test');
    const spawn = worldOverlay().spawn;
    expect(s.x).toBe(spawn.x);
    expect(s.y).toBe(spawn.y);
  });
});
