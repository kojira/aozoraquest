/**
 * 手編集ワールドの読み込み (web 側) — レコードの**有無**で適用を決める (#660)。
 * edge (`apps/edge/test/world-authoring.test.ts`) と同じ不変条件:
 *   - レコードが存在すれば**空配列でも適用する** (全削除の保存は {npcs: []})
 *   - レコードが無ければ触らない
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { allNpcs, setNpcs, setShopOverrides, shopOverrides, type NpcDef, type ShopOverride } from '@aozoraquest/core';
import { loadAuthoredWorld } from './world-authoring';

const DID = 'did:plc:admin';
const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };
const SHOP: ShopOverride = { x: 10, y: 20, consumables: [] };

/** 管理者 repo のふり。`records` に無いコレクションは RecordNotFound を投げる。 */
function fakeAgent(records: Record<string, unknown>): Agent {
  const getRecord = async ({ collection }: { collection: string }) => {
    const key = collection.slice(collection.lastIndexOf('.') + 1);
    if (key in records) return { data: { uri: `at://${DID}/${collection}/self`, cid: 'cid1', value: records[key] } };
    const err = new Error('Could not locate record');
    err.name = 'RecordNotFoundError';
    throw err;
  };
  return { com: { atproto: { repo: { getRecord } } } } as unknown as Agent;
}

describe('loadAuthoredWorld: 空配列のレコードを適用する (#660)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ADMIN_DIDS', DID);
    setNpcs([NPC]);
    setShopOverrides([SHOP]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    setNpcs(null);
    setShopOverrides(null);
  });

  it('NPC: {npcs: []} で全 NPC が消える', async () => {
    await loadAuthoredWorld(fakeAgent({ npcs: { npcs: [] } }));
    expect(allNpcs()).toEqual([]);
  });

  it('NPC: レコードが無ければメモリの NPC を保持する', async () => {
    await loadAuthoredWorld(fakeAgent({}));
    expect(allNpcs().map((n) => n.id)).toEqual(['elder']);
  });

  it('店: {shops: []} で全上書きが外れる', async () => {
    await loadAuthoredWorld(fakeAgent({ shops: { shops: [] } }));
    expect(shopOverrides()).toEqual([]);
  });

  it('店: レコードが無ければメモリの上書きを保持する', async () => {
    await loadAuthoredWorld(fakeAgent({}));
    expect(shopOverrides().map((s) => [s.x, s.y])).toEqual([[10, 20]]);
  });
});
