/**
 * 手編集ワールドの読み込み (edge 側) — レコードの**有無**で適用を決める (#660)。
 *
 * 守るべき不変条件:
 *   - レコードが**存在すれば空配列でも適用する** (全削除の保存は {npcs: []} になる。
 *     length で弾くと warm isolate に削除済みのものが残り続ける)
 *   - レコードが**無ければ触らない** (読めない日にメモリの定義を消さない)
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { allNpcs, setNpcs, setShopOverrides, shopOverrides, type NpcDef, type ShopOverride } from '@aozoraquest/core';
import { ensureAuthoredWorld, resetAuthoredWorldCache } from '../src/world-authoring';

const DID = 'did:plc:admin';
const PDS = 'https://pds.test';
const NSID = 'app.aozoraquest';
const NOW = 1_700_000_000;

const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };
const SHOP: ShopOverride = { x: 10, y: 20, consumables: [] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 管理者 PDS のふり。`records` に無いコレクションは RecordNotFound。 */
function fakePds(records: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://plc.directory/')) {
      return json(200, { id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    }
    if (url.startsWith(`${PDS}/xrpc/com.atproto.repo.getRecord?`)) {
      const col = new URL(url).searchParams.get('collection') ?? '';
      const key = col.slice(`${NSID}.world.`.length);
      if (key in records) return json(200, { uri: `at://${DID}/${col}/self`, cid: 'cid1', value: records[key] });
      return json(400, { error: 'RecordNotFound', message: 'Could not locate record' });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
}

describe('ensureAuthoredWorld: 空配列のレコードを適用する (#660)', () => {
  const orig = globalThis.fetch;
  const env = { ADMIN_DIDS: DID };

  beforeEach(() => {
    resetAuthoredWorldCache();
    setNpcs([NPC]);
    setShopOverrides([SHOP]);
  });
  afterEach(() => {
    globalThis.fetch = orig;
    resetAuthoredWorldCache();
    setNpcs(null);
    setShopOverrides(null);
  });

  it('NPC: {npcs: []} で全 NPC が消える', async () => {
    globalThis.fetch = fakePds({ npcs: { npcs: [] } });
    await ensureAuthoredWorld(env, NSID, NOW);
    expect(allNpcs()).toEqual([]);
  });

  it('NPC: レコードが無ければメモリの NPC を保持する', async () => {
    globalThis.fetch = fakePds({});
    await ensureAuthoredWorld(env, NSID, NOW);
    expect(allNpcs().map((n) => n.id)).toEqual(['elder']);
  });

  it('店: {shops: []} で全上書きが外れる', async () => {
    globalThis.fetch = fakePds({ shops: { shops: [] } });
    await ensureAuthoredWorld(env, NSID, NOW);
    expect(shopOverrides()).toEqual([]);
  });

  it('店: レコードが無ければメモリの上書きを保持する', async () => {
    globalThis.fetch = fakePds({});
    await ensureAuthoredWorld(env, NSID, NOW);
    expect(shopOverrides().map((s) => [s.x, s.y])).toEqual([[10, 20]]);
  });
});
