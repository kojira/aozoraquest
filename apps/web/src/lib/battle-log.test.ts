import { describe, expect, test, vi } from 'vitest';
import { loadBattleStats, countBattles } from './battle-log';

/** battle レコード列 (新しい順 = listRecords の返却順) を返す mock agent。 */
function makeAgent(records: Array<{ outcome?: string; tier?: number; drops?: unknown; herbsUsed?: number; tonicsUsed?: number }>): any {
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

  test('fled は連勝を切るが敗北には数えない', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'fled', tier: 1 },
        { outcome: 'win', tier: 1 },
      ]),
      'did:test',
    );
    expect(s.losses).toBe(0);
    expect(s.wins).toBe(1);
    expect(s.currentStreak).toBe(0); // 先頭が fled なので現在連勝は 0
    expect(s.bestStreak).toBe(1);
  });

  test('そらのしずく在庫 = ドロップ獲得 − 使用 (tonicsUsed)、0 以下なら消える', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 2, drops: ['sky-dew', 'wisp-ember'] },
        { outcome: 'fled', tier: 2, tonicsUsed: 1 }, // 逃げた戦でも使った分は消費
        { outcome: 'win', tier: 2, drops: ['sky-dew'] },
      ]),
      'did:test',
    );
    expect(s.materials['sky-dew']).toBe(1); // 2 獲得 − 1 使用
    expect(s.materials['wisp-ember']).toBe(1);
    const s2 = await loadBattleStats(
      makeAgent([{ outcome: 'win', tier: 2, drops: ['sky-dew'] }, { outcome: 'win', tier: 2, tonicsUsed: 3 }]),
      'did:test',
    );
    expect(s2.materials['sky-dew']).toBeUndefined(); // 使いすぎは 0 止め
  });

  test('敗北の materialsLost は在庫から差し引かれる (勝利レコードの値は無視)', async () => {
    const s = await loadBattleStats(
      makeAgent([
        { outcome: 'win', tier: 1, drops: ['slime-drop', 'slime-drop', 'herb'] },
        { outcome: 'lose', tier: 1, materialsLost: ['slime-drop', 'herb'] },
        // 勝利レコードに materialsLost が紛れても数えない (敗北のみ)
        { outcome: 'win', tier: 1, drops: ['bat-wing'], materialsLost: ['bat-wing'] },
      ] as any),
      'did:test',
    );
    expect(s.materials['slime-drop']).toBe(1); // 2 獲得 − 1 ロス
    expect(s.materials['herb']).toBeUndefined(); // 1 獲得 − 1 ロス
    expect(s.materials['bat-wing']).toBe(1); // win の materialsLost は無視
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

  test('awardBattleXp はレベルアップを検出して返す (境界をまたぐ/またがない/offset)', async () => {
    const { playerLevelFromXp, jobLevelFromXp } = await import('@aozoraquest/core');
    // +30 でプレイヤーレベル境界をまたぐ xp を決定的に探す
    let crossing = -1;
    for (let x = 0; x < 5000; x++) {
      if (playerLevelFromXp(x) < playerLevelFromXp(x + 30)) { crossing = x; break; }
    }
    expect(crossing).toBeGreaterThanOrEqual(0);
    const mkAgent = (playerXp: number, jobXp: number) => ({
      assertDid: 'did:test',
      com: { atproto: { repo: {
        getRecord: vi.fn(async () => ({ data: { value: {
          $type: 'x.analysis', archetype: 'sage', analyzedAt: '2026-01-01T00:00:00.000Z',
          playerLevel: { xp: playerXp, streakDays: 0 },
          jobLevel: { archetype: 'sage', xp: jobXp, joinedAt: '2026-01-01T00:00:00.000Z' },
        } } })),
        putRecord: vi.fn(async () => ({ data: {} })),
      } } },
    }) as any;
    const { awardBattleXp } = await import('./battle-log');
    // またぐ: player は from→to、job は同じ xp なら jobLevelFromXp 基準で判定される
    const ups = await awardBattleXp(mkAgent(crossing, 0), 'did:test', 30);
    expect(ups?.player).toEqual({ from: playerLevelFromXp(crossing), to: playerLevelFromXp(crossing + 30) });
    // またがない: 直後 (crossing+30) から +30 が境界を再度またぐとは限らないので Lv1 序盤で確認
    const flat = await awardBattleXp(mkAgent(0, 0), 'did:test', 1);
    expect(flat?.player).toBeUndefined();
    // offset: jobXpOffset を足した位置で判定される (表示レベルとの一致)。
    // 「offset なしなら境界をまたぐが、offset を足すとまたがない」xp を探すことで、
    // 実装が offset を無視していたら fail する判別力を持たせる (レビュー指摘:
    // 初版は offset 0 と同じ結果になる縮退ケースだった)
    let discriminating = -1;
    for (let off = 1; off < 5000; off++) {
      const noOff = jobLevelFromXp(0) < jobLevelFromXp(30); // base 0 は +30 で必ずまたぐ (LV2 閾値 30)
      const withOff = jobLevelFromXp(off) < jobLevelFromXp(off + 30);
      if (noOff && !withOff) { discriminating = off; break; }
    }
    expect(discriminating).toBeGreaterThan(0);
    const noUp = await awardBattleXp(mkAgent(0, 0), 'did:test', 30, { jobXpOffset: discriminating });
    expect(noUp?.job).toBeUndefined(); // offset 適用でまたがない
    const withUp = await awardBattleXp(mkAgent(0, 0), 'did:test', 30);
    expect(withUp?.job).toEqual({ from: 1, to: jobLevelFromXp(30), archetype: 'sage' }); // offset なしはまたぐ
    // playerXpOffset も同様に判別力のあるケースで検証
    const pNoUp = await awardBattleXp(mkAgent(crossing, 0), 'did:test', 30, { playerXpOffset: 5000 });
    expect(pNoUp?.player?.from).not.toBe(playerLevelFromXp(crossing)); // offset が効いて基準が動く
  });

  test('awardBattleXp は analysis 未作成なら何も書かない', async () => {
    const getRecordFn = vi.fn(async () => { throw new Error('not found'); });
    const putRecordFn = vi.fn();
    const agent = {
      assertDid: 'did:test',
      com: { atproto: { repo: { getRecord: getRecordFn, putRecord: putRecordFn } } },
    } as any;
    const { awardBattleXp } = await import('./battle-log');
    const r = await awardBattleXp(agent, 'did:test', 30);
    expect(r).toBeNull();
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
