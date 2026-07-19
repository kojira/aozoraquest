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

describe('countBattles', () => {
  test('件数を数える / エラー時は途中まで', async () => {
    expect(await countBattles(makeAgent([{ outcome: 'win' }, { outcome: 'lose' }]), 'did:test')).toBe(2);
    const err = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('x'); }) } } } } as any;
    expect(await countBattles(err, 'did:test')).toBe(0);
  });
});
