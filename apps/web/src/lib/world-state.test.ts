import { describe, expect, test, vi } from 'vitest';
import { REGION_COUNT, regionOf, regionsAround, worldOverlay } from '@aozoraquest/core';
import { loadWorldState, saveWorldState } from './world-state';

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

describe('loadWorldState — ちずのかけら (regions)', () => {
  test('保存済みの regions を検証つきで読む (範囲外・非整数・重複は除去)', async () => {
    const agent = agentWithGetRecord(async () => ({
      data: { value: { x: 10, y: 10, regions: [3, 3, 1, -1, 999, 1.5, 'x'] } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    expect(s.regions).toEqual([1, 3]);
  });

  test('旧レコード (regions なし) は lastTown と現在地の両方の 3×3 でシードする (移行措置)', async () => {
    const spawn = worldOverlay().spawn;
    const agent = agentWithGetRecord(async () => ({
      data: { value: { x: 10, y: 10, lastTownX: spawn.x, lastTownY: spawn.y } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    const want = [...new Set([...regionsAround(regionOf(10, 10)), ...regionsAround(regionOf(spawn.x, spawn.y))])].sort((a, b) => a - b);
    expect(s.regions).toEqual(want);
    // 現在地もフォグに浮かない (レビュー指摘の回帰テスト)
    expect(s.regions).toContain(regionOf(10, 10));
  });

  test('空配列の regions は missing 扱いでシードする (全面フォグの固定化を防ぐ)', async () => {
    const agent = agentWithGetRecord(async () => ({
      data: { value: { x: 10, y: 10, regions: [] } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    expect(s.regions.length).toBeGreaterThan(0);
  });

  test('x/y が壊れたレコードでも regions は保全される (spawn の 3×3 と union)', async () => {
    const agent = agentWithGetRecord(async () => ({
      data: { value: { x: 'a', y: null, regions: [42] } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    expect(s.regions).toContain(42);
    expect(s.regions).toContain(worldOverlay().spawn.region);
  });

  test('saveWorldState は regions / visitedTowns / gotStarterFeather を書く (保存漏れの回帰テスト)', async () => {
    const putRecord = vi.fn(async () => ({ data: {} }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { putRecord } } } } as any;
    await saveWorldState(agent, { x: 1, y: 2, hp: null, mp: null, lastTown: null, regions: [3, 4], visitedTowns: [{ x: 5, y: 6 }], gotStarterFeather: true });
    const rec = (putRecord.mock.calls as any[])[0][0].record;
    expect(rec.regions).toEqual([3, 4]);
    expect(rec.visitedTowns).toEqual([{ x: 5, y: 6 }]);
    expect(rec.gotStarterFeather).toBe(true);
  });

  test('visitedTowns は 非オブジェクト/NaN/非街座標/重複を除去する', async () => {
    const spawn = worldOverlay().spawn;
    const agent = agentWithGetRecord(async () => ({
      data: { value: {
        x: 10, y: 10,
        visitedTowns: [
          { x: spawn.x, y: spawn.y },
          { x: spawn.x, y: spawn.y }, // 重複
          { x: 'a', y: 1 },           // NaN
          'junk',                      // 非オブジェクト
          null,
          { x: 3, y: 3 },             // 非街座標 (townAt が無い想定)
        ],
      } },
    }));
    const s = await loadWorldState(agent, 'did:test');
    // spawn (実在の街) が 1 件だけ残る。非街/壊れは除去
    expect(s.visitedTowns).toEqual([{ x: spawn.x, y: spawn.y }]);
  });

  test('新規プレイヤーは visitedTowns 空 / gotStarterFeather false (初回配布のトリガー)', async () => {
    const agent = agentWithGetRecord(async () => {
      const e = new Error('Could not locate record') as Error & { error?: string };
      e.error = 'RecordNotFound';
      throw e;
    });
    const s = await loadWorldState(agent, 'did:test');
    expect(s.visitedTowns).toEqual([]);
    expect(s.gotStarterFeather).toBe(false);
  });

  test('新規プレイヤーは はじまりの街の地方一帯 (3×3) だけ開示された状態から', async () => {
    const agent = agentWithGetRecord(async () => {
      const e = new Error('Could not locate record') as Error & { error?: string };
      e.error = 'RecordNotFound';
      throw e;
    });
    const s = await loadWorldState(agent, 'did:test');
    const spawn = worldOverlay().spawn;
    expect(s.regions).toEqual(regionsAround(spawn.region));
    expect(s.regions.length).toBe(9);
    expect(s.regions.length).toBeLessThan(REGION_COUNT); // 全図は見えない
  });
});
