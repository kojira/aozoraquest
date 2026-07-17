/**
 * なんでも屋の制作 (docs/20-shop-equipment.md, W6b)。
 *
 * 1 制作 = 1 レコード (`COL.craft`)。**品質はレコードの rkey + 制作時 luk から
 * 決定的に導出**する — 品質フィールドを自己申告で書かない (書いても無視する) ので
 * レコードを増やさず偽造耐性がある (docs/20 の個体モデル)。
 * 消費の記帳: パワーは power/self の craftPowerSpent 累積、素材はこのコレクションの
 * 集計で在庫から差し引く。
 */

import type { Agent } from '@atproto/api';
import { craftQuality, craftSeedFromRkey } from '@aozoraquest/core';
import { VIA } from './atproto';
import { COL } from './collections';

export interface CraftRecord {
  $type: string;
  /** 作った装備 (EQUIPMENT の id) */
  itemId: string;
  /** 支払った素材 (種類と個数) */
  materialId: string;
  materialCount: number;
  /** 支払ったあおぞらパワー */
  power: number;
  /** 制作時の luk (品質導出の入力。クライアント申告値 — 検証可能化は W3) */
  luk: number;
  at: string;
  via: string;
}

export interface CraftedPiece {
  rkey: string;
  itemId: string;
  quality: number;
  at: string;
}

/** 制作を記帳し、確定した品質を返す。 */
export async function craftItem(
  agent: Agent,
  input: Pick<CraftRecord, 'itemId' | 'materialId' | 'materialCount' | 'power' | 'luk'>,
): Promise<CraftedPiece> {
  const did = agent.assertDid;
  const rkey = `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await agent.com.atproto.repo.createRecord({
    repo: did,
    collection: COL.craft,
    rkey,
    record: {
      $type: COL.craft,
      ...input,
      at: new Date().toISOString(),
      via: VIA,
    } satisfies CraftRecord,
  });
  return {
    rkey,
    itemId: input.itemId,
    quality: craftQuality(craftSeedFromRkey(rkey), input.luk),
    at: new Date().toISOString(),
  };
}

export interface CraftInventory {
  /** 所持している制作品 (新しい順)。品質はレコードから再導出済み */
  pieces: CraftedPiece[];
  /** 制作で消費した素材の合計 (素材在庫の集計で差し引く) */
  materialsSpent: Record<string, number>;
}

/** craft レコードを集計する (最大 500 件)。 */
export async function loadCraftInventory(agent: Agent, did: string): Promise<CraftInventory> {
  const pieces: CraftedPiece[] = [];
  const materialsSpent: Record<string, number> = {};
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    let res;
    try {
      res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.craft,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
    } catch {
      break; // 未作成
    }
    for (const r of res.data.records) {
      const v = r.value as Partial<CraftRecord>;
      const rkey = r.uri.split('/').pop() ?? '';
      if (typeof v.itemId !== 'string' || rkey === '') continue;
      const luk = typeof v.luk === 'number' && Number.isFinite(v.luk) ? v.luk : 0;
      pieces.push({
        rkey,
        itemId: v.itemId,
        quality: craftQuality(craftSeedFromRkey(rkey), luk),
        at: typeof v.at === 'string' ? v.at : '',
      });
      if (typeof v.materialId === 'string' && typeof v.materialCount === 'number' && v.materialCount > 0) {
        materialsSpent[v.materialId] = (materialsSpent[v.materialId] ?? 0) + Math.floor(v.materialCount);
      }
    }
    const next = res.data.cursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return { pieces, materialsSpent };
}
