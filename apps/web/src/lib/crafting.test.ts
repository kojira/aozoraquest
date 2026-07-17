import { describe, expect, test, vi } from 'vitest';
import { craftItem, loadCraftInventory } from './crafting';
import { craftLevelRoll, craftSeedFromRkey } from '@aozoraquest/core';

describe('craftItem', () => {
  test('craft レコードを作成し、rkey + luk から導出した強化値を返す (レコードに level は書かない)', async () => {
    const createRecord = vi.fn(async (_a: any) => ({ data: { uri: 'at://x', cid: 'c' } }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { createRecord } } } } as any;
    const piece = await craftItem(agent, { itemId: 'wp-knife', materialId: 'slime-drop', materialCount: 1, power: 4, luk: 20 });
    const arg = createRecord.mock.calls[0]![0] as any;
    expect(arg.rkey).toMatch(/^c-/);
    expect(arg.record.itemId).toBe('wp-knife');
    expect(arg.record.power).toBe(4);
    expect(arg.record.luk).toBe(20);
    // 強化値はレコード側に書かない (自己申告させない) — rkey から再導出できる
    expect(arg.record.level).toBeUndefined();
    expect(piece.level).toBe(craftLevelRoll(craftSeedFromRkey(arg.rkey), 20));
  });

  test('rkey を渡すと同じ rkey で書く (再試行の冪等化)', async () => {
    const createRecord = vi.fn(async (_a: any) => ({ data: { uri: 'at://x', cid: 'c' } }));
    const agent = { assertDid: 'did:test', com: { atproto: { repo: { createRecord } } } } as any;
    await craftItem(agent, { itemId: 'wp-knife', materialId: 'slime-drop', materialCount: 1, power: 4, luk: 0 }, 'c-fixed');
    expect((createRecord.mock.calls[0]![0] as any).rkey).toBe('c-fixed');
  });
});

describe('loadCraftInventory (制作 + 合成の集計と検証)', () => {
  const makeAgent = (records: Array<{ rkey: string; value: any }>): any => ({
    com: { atproto: { repo: { listRecords: vi.fn(async ({ cursor }: { cursor?: string }) => {
      if (cursor) return { data: { records: [] } };
      return { data: { records: records.map((r) => ({ uri: `at://did:test/craft/${r.rkey}`, cid: 'c', value: r.value })) } };
    }) } } },
  });
  const craft = (rkey: string, itemId: string, luk = 0, materialId = 'slime-drop', materialCount = 1) => ({
    rkey,
    value: { itemId, materialId, materialCount, luk, at: rkey },
  });
  const levelOf = (rkey: string, luk = 0) => craftLevelRoll(craftSeedFromRkey(rkey), luk);

  /** 同じ強化値になる 2 つの rkey を決定的に探す */
  const samePair = (): [string, string] => {
    for (let i = 0; i < 200; i++) {
      for (let j = i + 1; j < 200; j++) {
        if (levelOf(`c-${i}`) === levelOf(`c-${j}`)) return [`c-${i}`, `c-${j}`];
      }
    }
    throw new Error('no pair');
  };

  test('制作個体の強化値と素材消費を集計する。壊れたレコードはスキップ', async () => {
    const inv = await loadCraftInventory(
      makeAgent([
        craft('c-0', 'wp-knife', 10),
        craft('c-1', 'wp-bard-mid', 31, 'slime-drop', 4),
        { rkey: 'c-2', value: { materialId: 'bat-wing', materialCount: 2 } }, // itemId 欠落
      ]),
      'did:test',
    );
    expect(inv.pieces.length).toBe(2);
    expect(inv.pieces.find((p) => p.rkey === 'c-0')!.level).toBe(levelOf('c-0', 10));
    expect(inv.materialsSpent).toEqual({ 'slime-drop': 5 });
  });

  test('合成: 同 itemId・同強化値の 2 個体を消費して +1 の 1 個体になる', async () => {
    const [a, b] = samePair();
    const lv = levelOf(a);
    const inv = await loadCraftInventory(
      makeAgent([
        craft(a, 'wp-knife'),
        craft(b, 'wp-knife'),
        { rkey: 'f-0', value: { itemId: 'wp-knife', level: lv + 1, consumed: [a, b], at: 'z' } },
      ]),
      'did:test',
    );
    expect(inv.pieces.length).toBe(1);
    expect(inv.pieces[0]!.rkey).toBe('f-0');
    expect(inv.pieces[0]!.level).toBe(lv + 1);
  });

  test('偽造合成は無効: レベル飛ばし・同一個体の二重指定・存在しない個体参照は黙って捨てる', async () => {
    const [a, b] = samePair();
    const lv = levelOf(a);
    const inv = await loadCraftInventory(
      makeAgent([
        craft(a, 'wp-knife'),
        craft(b, 'wp-knife'),
        { rkey: 'f-bad1', value: { itemId: 'wp-knife', level: lv + 3, consumed: [a, b], at: 'z1' } },
        { rkey: 'f-bad2', value: { itemId: 'wp-knife', level: lv + 1, consumed: [a, a], at: 'z2' } },
        { rkey: 'f-bad3', value: { itemId: 'wp-knife', level: lv + 1, consumed: ['c-nope', 'c-nope2'], at: 'z3' } },
      ]),
      'did:test',
    );
    expect(inv.pieces.map((p) => p.rkey).sort()).toEqual([a, b].sort());
  });

  test('連鎖合成: forge の産物をさらに forge できる (+N → +N+1 → +N+2)', async () => {
    const [a, b] = samePair();
    const lv = levelOf(a);
    // 同レベルのもう 1 組
    let c = '';
    let d = '';
    for (let i = 0; i < 800 && !d; i++) {
      const k = `c-x${i}`;
      if (levelOf(k) === lv) {
        if (!c) c = k;
        else d = k;
      }
    }
    expect(d).not.toBe('');
    const inv = await loadCraftInventory(
      makeAgent([
        craft(a, 'wp-knife'),
        craft(b, 'wp-knife'),
        craft(c, 'wp-knife'),
        craft(d, 'wp-knife'),
        { rkey: 'f-1', value: { itemId: 'wp-knife', level: lv + 1, consumed: [a, b], at: 'z1' } },
        { rkey: 'f-2', value: { itemId: 'wp-knife', level: lv + 1, consumed: [c, d], at: 'z2' } },
        { rkey: 'f-3', value: { itemId: 'wp-knife', level: lv + 2, consumed: ['f-1', 'f-2'], at: 'z3' } },
      ]),
      'did:test',
    );
    expect(inv.pieces.length).toBe(1);
    expect(inv.pieces[0]!.rkey).toBe('f-3');
    expect(inv.pieces[0]!.level).toBe(lv + 2);
  });

  test('ひきとりレコードは素材消費に計上され、個体は生まれない', async () => {
    const inv = await loadCraftInventory(
      makeAgent([
        craft('c-0', 'wp-knife', 0, 'slime-drop', 2),
        { rkey: 's-0', value: { materialId: 'slime-drop', materialCount: 10, powerGained: 2, at: 'z' } },
        // powerGained のない itemId 欠落レコードは従来どおりスキップ
        { rkey: 'c-broken', value: { materialId: 'bat-wing', materialCount: 3 } },
      ]),
      'did:test',
    );
    expect(inv.pieces.length).toBe(1);
    expect(inv.materialsSpent).toEqual({ 'slime-drop': 12 });
  });

  test('未作成コレクションは空で返す', async () => {
    const agent = { com: { atproto: { repo: { listRecords: vi.fn(async () => { throw new Error('x'); }) } } } } as any;
    const inv = await loadCraftInventory(agent, 'did:test');
    expect(inv.pieces).toEqual([]);
    expect(inv.materialsSpent).toEqual({});
  });
});
