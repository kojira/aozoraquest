import { describe, expect, test, vi } from 'vitest';
import { loadBattleStats, countBattles } from './battle-log';

/** battle レコード列 (新しい順 = listRecords の返却順) を返す mock agent。 */
function makeAgent(records: Array<{ outcome?: string; tier?: number; drops?: unknown; herbsUsed?: number }>): any {
  const listRecords = vi.fn(async ({ cursor }: { collection: string; cursor?: string }) => {
    if (cursor) return { data: { records: [] } };
    return {
      data: {
        records: records.map((v, i) => ({ uri: `at://did:test/battle/${i}`, cid: `c${i}`, value: v })),
      },
    };
  });
  return { com: { atproto: { repo: { listRecords } } } };
}

describe('loadBattleStats', () => {
  test('空: 全部 0', async () => {
    const s = await loadBattleStats(makeAgent([]), 'did:test');
    expect(s).toEqual({ wins: 0, losses: 0, bestStreak: 0, tier3Wins: 0, materials: {}, currentStreak: 0, total: 0 });
  });

  test('勝敗と tier3 勝利のカウント', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 3 },
        { outcome: 'lose', tier: 1 },
        { outcome: 'win', tier: 1 },
        { outcome: 'win', tier: 3 },
      ]),
      'did:test',
    );
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(1);
    expect(s.tier3Wins).toBe(2);
    expect(s.total).toBe(4);
  });

  test('currentStreak は先頭 (新しい順) からの連続勝利', async () => {
    // 新しい順: win, win, lose, win → 現在 2 連勝
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 1 },
        { outcome: 'win', tier: 1 },
        { outcome: 'lose', tier: 1 },
        { outcome: 'win', tier: 1 },
      ]),
      'did:test',
    );
    expect(s.currentStreak).toBe(2);
  });

  test('bestStreak は時系列の最長連勝 (向きに依存しない)', async () => {
    // 新しい順: lose, win, win, win, lose, win → 最長 3
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'lose', tier: 1 },
        { outcome: 'win', tier: 1 },
        { outcome: 'win', tier: 1 },
        { outcome: 'win', tier: 1 },
        { outcome: 'lose', tier: 1 },
        { outcome: 'win', tier: 1 },
      ]),
      'did:test',
    );
    expect(s.bestStreak).toBe(3);
    expect(s.currentStreak).toBe(0);
  });

  test('draw は連勝を切るが敗北には数えない', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'draw', tier: 1 },
        { outcome: 'win', tier: 1 },
      ]),
      'did:test',
    );
    expect(s.losses).toBe(0);
    expect(s.wins).toBe(1);
    expect(s.currentStreak).toBe(0); // 先頭が draw なので現在連勝は 0
  });

  test('素材は勝利分だけ集計、壊れた drops は無視', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 1, drops: ['slime-drop', 'slime-drop'] },
        { outcome: 'win', tier: 2, drops: ['golem-core', 42, null] },
        { outcome: 'lose', tier: 1, drops: ['oni-horn'] }, // 敗北の drops は数えない (勝利時のみ書かれる)
        { outcome: 'win', tier: 1, drops: 'not-an-array' },
      ]),
      'did:test',
    );
    expect(s.materials).toEqual({ 'slime-drop': 2, 'golem-core': 1 });
  });

  test('やくそう在庫 = ドロップ獲得 − 使用 (herbsUsed)、0 以下なら消える', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 1, drops: ['herb', 'slime-drop'] },
        { outcome: 'lose', tier: 2, herbsUsed: 1 }, // 負け戦でも使った分は消費
        { outcome: 'win', tier: 1, drops: ['herb'] },
      ]),
      'did:test',
    );
    expect(s.materials['herb']).toBe(1); // 2 獲得 − 1 使用
    expect(s.materials['slime-drop']).toBe(1);
    const s2 = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 1, drops: ['herb'] },
        { outcome: 'win', tier: 1, herbsUsed: 3 },
      ]),
      'did:test',
    );
    expect(s2.materials['herb']).toBeUndefined(); // 使いすぎは 0 止め (負にならない)
  });

  test('outcome 欠落は lose 扱い (中断された仮レコード = 棄権)', async () => {
    const s = await loadBattleStats(makeAgent([{ tier: 1 }]), 'did:test');
    expect(s.losses).toBe(1);
  });

  test('listRecords がエラーでも空 stats を返す (未作成コレクション)', async () => {
    const agent = {
      com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('nope'); }) } } },
    } as any;
    const s = await loadBattleStats(agent, 'did:test');
    expect(s.total).toBe(0);
  });
});

describe('record lifecycle (start/finish/awardBattleXp)', () => {
  test('startBattleRecord は仮敗北 (outcome=lose, turns=0) を createRecord し rkey を返す', async () => {
    const createRecord = vi.fn(async (_args: any) => ({ data: { uri: 'at://x', cid: 'c' } }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { createRecord } } } } as any;
    const { startBattleRecord } = await import('./battle-log');
    const rkey = await startBattleRecord(agent, { seed: 42, tier: 2, monsterId: 'moss-golem' });
    expect(rkey).toMatch(/^b-/);
    const arg = createRecord.mock.calls[0]![0] as any;
    expect(arg.rkey).toBe(rkey);
    expect(arg.record.outcome).toBe('lose');
    expect(arg.record.turns).toBe(0);
    expect(arg.record.drops).toEqual([]);
    expect(arg.record.seed).toBe(42);
  });

  test('finishBattleRecord は同じ rkey に putRecord で確定を上書きする', async () => {
    const putRecord = vi.fn(async (_args: any) => ({ data: {} }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { putRecord } } } } as any;
    const { finishBattleRecord } = await import('./battle-log');
    await finishBattleRecord(agent, 'b-abc', {
      seed: 42, tier: 2, monsterId: 'moss-golem', outcome: 'win', turns: 7, drops: ['golem-core'],
    });
    const arg = putRecord.mock.calls[0]![0] as any;
    expect(arg.rkey).toBe('b-abc');
    expect(arg.record.outcome).toBe('win');
    expect(arg.record.drops).toEqual(['golem-core']);
  });

  test('awardBattleXp は analysis の未知フィールドを保持したまま XP を加算する', async () => {
    let saved: any = null;
    const getRecordFn = vi.fn(async () => ({
      data: {
        value: {
          $type: 'x.analysis',
          archetype: 'sage',
          analyzedAt: '2026-01-01T00:00:00.000Z',
          cognitiveScores: { Ni: 0.5 }, // 未知フィールド (型に無い) が消えないこと
          playerLevel: { xp: 100, streakDays: 3 },
          jobLevel: { archetype: 'sage', xp: 50, joinedAt: '2026-01-01T00:00:00.000Z' },
        },
      },
    }));
    const putRecordFn = vi.fn(async (args: any) => { saved = args.record; return { data: {} }; });
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: { getRecord: getRecordFn, putRecord: putRecordFn } } },
    } as any;
    const { awardBattleXp } = await import('./battle-log');
    await awardBattleXp(agent, 'did:test', 30);
    expect(saved.playerLevel.xp).toBe(130);
    expect(saved.jobLevel.xp).toBe(80);
    expect(saved.cognitiveScores).toEqual({ Ni: 0.5 });
    expect(saved.playerLevel.streakDays).toBe(3);
  });

  test('awardBattleXp は analysis 未作成なら何も書かない', async () => {
    const getRecordFn = vi.fn(async () => { throw new Error('not found'); });
    const putRecordFn = vi.fn();
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: { getRecord: getRecordFn, putRecord: putRecordFn } } },
    } as any;
    const { awardBattleXp } = await import('./battle-log');
    await awardBattleXp(agent, 'did:test', 30);
    expect(putRecordFn).not.toHaveBeenCalled();
  });
});

describe('countBattles', () => {
  test('件数を数える / エラー時は途中まで', async () => {
    expect(await countBattles(makeAgent([{ outcome: 'win' }, { outcome: 'lose' }]), 'did:test')).toBe(2);
    const err = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('x'); }) } } } } as any;
    expect(await countBattles(err, 'did:test')).toBe(0);
  });
});
