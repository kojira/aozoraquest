import { describe, expect, test, vi } from 'vitest';
import { craftItem, loadCraftInventory } from './crafting';
import { craftQuality, craftSeedFromRkey } from '@aozoraquest/core';

describe('craftItem', () => {
  test('craft レコードを作成し、rkey + luk から導出した品質を返す', async () => {
    const createRecord = vi.fn(async (_a: any) => ({ data: { uri: 'at://x', cid: 'c' } }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { createRecord } } } } as any;
    const piece = await craftItem(agent, { itemId: 'wp-knife', materialId: 'slime-drop', materialCount: 1, power: 4, luk: 20 });
    const arg = createRecord.mock.calls[0]![0] as any;
    expect(arg.rkey).toMatch(/^c-/);
    expect(arg.record.itemId).toBe('wp-knife');
    expect(arg.record.power).toBe(4);
    expect(arg.record.luk).toBe(20);
    // 品質はレコード側に書かない (自己申告させない) — rkey から再導出できる
    expect(arg.record.quality).toBeUndefined();
    expect(piece.quality).toBe(craftQuality(craftSeedFromRkey(arg.rkey), 20));
  });
});

describe('loadCraftInventory', () => {
  const makeAgent = (records: Array<Partial<{ itemId: string; materialId: string; materialCount: number; luk: number; at: string }>>): any => ({
    com: { atproto: { repo: { listRecords: vi.fn(async ({ cursor }: { cursor?: string }) => {
      if (cursor) return { data: { records: [] } };
      return { data: { records: records.map((v, i) => ({ uri: `at://did:test/craft/c-${i}`, cid: `c${i}`, value: v })) } };
    }) } } },
  });

  test('個体 (品質つき) と素材消費を集計する。壊れたレコードはスキップ', async () => {
    const inv = await loadCraftInventory(
      makeAgent([
        { itemId: 'wp-knife', materialId: 'slime-drop', materialCount: 1, luk: 10, at: 't1' },
        { itemId: 'wp-bard-mid', materialId: 'slime-drop', materialCount: 4, luk: 31, at: 't2' },
        { materialId: 'bat-wing', materialCount: 2 }, // itemId 欠落 → スキップ (素材も数えない)
      ]),
      'did:test',
    );
    expect(inv.pieces.length).toBe(2);
    expect(inv.pieces[0]!.quality).toBe(craftQuality(craftSeedFromRkey('c-0'), 10));
    expect(inv.materialsSpent).toEqual({ 'slime-drop': 5 });
  });

  test('未作成コレクションは空で返す', async () => {
    const agent = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('x'); }) } } } } as any;
    const inv = await loadCraftInventory(agent, 'did:test');
    expect(inv.pieces).toEqual([]);
    expect(inv.materialsSpent).toEqual({});
  });
});
