import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { EQUIPMENT_BY_ID, SALE_TUNING, townShopStock, worldOverlay } from '@aozoraquest/core';
import { shopCraft, shopSell, shopForge, ShopError, MAX_SHOP_OPS } from '../src/shop';
import { sanitizeGear } from '../src/battle-resolver';
import { rkeyForDid, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
import { writeServerTokens } from '../src/oauth-store';

const DID = 'did:plc:alice';
const SERVER_DID = 'did:plc:testserver';
const PDS = 'https://pds.example';
const NOW = 1_700_000_000;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
function mockKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
}
async function makeEnv(): Promise<GameStateEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: NOW });
  return { SERVER_DID, OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}
function statefulPds(seed?: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>();
  if (seed) store.set(rkeyForDid(DID), { value: seed, cid: 'c0' });
  let counter = 0;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('com.atproto.repo.getRecord')) {
      const rkey = new URL(url).searchParams.get('rkey')!;
      const rec = store.get(rkey);
      return rec ? json(200, { uri: `at://${rkey}`, cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    if (url.includes('com.atproto.repo.putRecord')) {
      const b = JSON.parse(init.body as string) as { rkey: string; record: unknown; swapRecord?: string | null };
      const cur = store.get(b.rkey);
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.set(b.rkey, { value: b.record, cid: `cid${++counter}` });
      return json(200, { uri: `at://${b.rkey}`, cid: `cid${counter}` });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store };
}
const stored = (store: Map<string, { value: unknown; cid: string }>) => store.get(rkeyForDid(DID))!.value as GameState;

/** 実在する街の 1 つと、その店の品揃え。 */
const towns = worldOverlay().towns;
const TOWN = towns[0]!;
const STOCK = townShopStock(TOWN, 0);
const ITEM = EQUIPMENT_BY_ID[STOCK.equipment[0]!]!;

const stateAt = (over: Partial<GameState> = {}): GameState => ({
  did: DID, power: 999, playerXp: 0, jobXp: {},
  materials: { [STOCK.materialId]: 99 },
  gear: [], x: TOWN.x, y: TOWN.y, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over,
});

describe('shopCraft (装備を作ってもらう)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('パワーと素材を権威側から引く', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    const r = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    expect(r.power).toBe(999 - ITEM.price.power);
    expect(r.materials[STOCK.materialId]).toBe(99 - ITEM.price.materials);
    // client が減算するだけだった頃は、リロードで権威側の在庫がそのまま戻った (= 素材の複製)
    expect(stored(m.store).power).toBe(999 - ITEM.price.power);
  });

  it('同じ rkey の再送では二重に課金しない', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    const again = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    expect(again.duplicate).toBe(true);
    expect(stored(m.store).power).toBe(999 - ITEM.price.power);
  });

  it('強化値は rkey から決定的 (再試行で値が変わらない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(stateAt()).fn;
    const a = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'same', luk: 10 }, NOW);
    globalThis.fetch = statefulPds(stateAt()).fn;
    const b = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'same', luk: 10 }, NOW);
    expect(a.level).toBe(b.level);
  });

  it('パワー不足 / 素材不足 は 400', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(stateAt({ power: 0 })).fn;
    await expect(shopCraft(env, DID, { itemId: ITEM.id, rkey: 'x', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'no_power' });
    globalThis.fetch = statefulPds(stateAt({ materials: {} })).fn;
    await expect(shopCraft(env, DID, { itemId: ITEM.id, rkey: 'y', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'no_material' });
  });

  it('街の外では買えない / その街に無い品は買えない', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(stateAt({ x: TOWN.x + 7, y: TOWN.y + 7 })).fn;
    await expect(shopCraft(env, DID, { itemId: ITEM.id, rkey: 'a', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'not_in_town' });
    // 品揃えに無い装備 (client が値段ごと送ってきても通らない)
    const notInStock = Object.values(EQUIPMENT_BY_ID).find((e) => !STOCK.equipment.includes(e.id))!;
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(shopCraft(env, DID, { itemId: notInStock.id, rkey: 'b', luk: 0 }, NOW)).rejects.toMatchObject({ code: 'not_in_stock' });
  });
});

describe('shopSell (素材のひきとり)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  const RATE = SALE_TUNING.materialsPerPower;

  it('素材を減らしてパワーを増やす', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt({ power: 0, materials: { [STOCK.materialId]: RATE * 3 } }));
    globalThis.fetch = m.fn;
    const r = await shopSell(env, DID, { materialId: STOCK.materialId, count: RATE * 3, rkey: 's1' }, NOW);
    expect(r.powerGained).toBe(3);
    expect(r.power).toBe(3);
    expect(stored(m.store).materials[STOCK.materialId]).toBeUndefined();
  });

  it('端数は引き取られない (減るのは換算できたぶんだけ)', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt({ power: 0, materials: { [STOCK.materialId]: RATE + 1 } }));
    globalThis.fetch = m.fn;
    const r = await shopSell(env, DID, { materialId: STOCK.materialId, count: RATE + 1, rkey: 's1' }, NOW);
    expect(r.powerGained).toBe(1);
    expect(stored(m.store).materials[STOCK.materialId]).toBe(1);
  });

  it('同じ rkey の再送では二重に入金しない', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt({ power: 0, materials: { [STOCK.materialId]: RATE * 2 } }));
    globalThis.fetch = m.fn;
    await shopSell(env, DID, { materialId: STOCK.materialId, count: RATE, rkey: 's1' }, NOW);
    const again = await shopSell(env, DID, { materialId: STOCK.materialId, count: RATE, rkey: 's1' }, NOW);
    expect(again.duplicate).toBe(true);
    expect(stored(m.store).power).toBe(1);
  });

  it('持っていない素材は売れない / 消耗品は売れない', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(stateAt({ materials: {} })).fn;
    await expect(shopSell(env, DID, { materialId: STOCK.materialId, count: RATE, rkey: 'z' }, NOW)).rejects.toMatchObject({ code: 'no_material' });
    globalThis.fetch = statefulPds(stateAt({ materials: { herb: 99 } })).fn;
    await expect(shopSell(env, DID, { materialId: 'herb', count: RATE, rkey: 'w' }, NOW)).rejects.toBeInstanceOf(ShopError);
  });

  it('冪等キーは直近 MAX_SHOP_OPS 件までのリング', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt({ power: 0, materials: { [STOCK.materialId]: RATE * (MAX_SHOP_OPS + 5) } }));
    globalThis.fetch = m.fn;
    for (let i = 0; i < MAX_SHOP_OPS + 5; i++) {
      await shopSell(env, DID, { materialId: STOCK.materialId, count: RATE, rkey: `s${i}` }, NOW);
    }
    expect(stored(m.store).shopOps!.length).toBe(MAX_SHOP_OPS);
  });
});

describe('shopForge (きたえる) と装備の所持検証 (#551 段階 2)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  const owned = (...ps: Array<{ rkey: string; itemId: string; level: number }>) => stateAt({ pieces: ps });

  it('同じ品・同じ強化値の 2 個体が +1 の 1 個体になる', async () => {
    const env = await makeEnv();
    const m = statefulPds(owned({ rkey: 'a', itemId: ITEM.id, level: 1 }, { rkey: 'b', itemId: ITEM.id, level: 1 }));
    globalThis.fetch = m.fn;
    const r = await shopForge(env, DID, { rkeys: ['a', 'b'], rkey: 'f1' }, NOW);
    expect(r.level).toBe(2);
    expect(r.pieces).toEqual([{ rkey: 'f1', itemId: ITEM.id, level: 2 }]);
  });

  it('持っていない個体は きたえられない (client が rkey を偽っても通らない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(owned({ rkey: 'a', itemId: ITEM.id, level: 1 })).fn;
    await expect(shopForge(env, DID, { rkeys: ['a', 'nope'], rkey: 'f' }, NOW)).rejects.toMatchObject({ code: 'not_owned' });
  });

  it('品や強化値が違うと きたえられない', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds(owned({ rkey: 'a', itemId: ITEM.id, level: 1 }, { rkey: 'b', itemId: ITEM.id, level: 2 })).fn;
    await expect(shopForge(env, DID, { rkeys: ['a', 'b'], rkey: 'f' }, NOW)).rejects.toMatchObject({ code: 'mismatch' });
  });

  it('同じ rkey の再送では二重に合成しない', async () => {
    const env = await makeEnv();
    const m = statefulPds(owned({ rkey: 'a', itemId: ITEM.id, level: 1 }, { rkey: 'b', itemId: ITEM.id, level: 1 }));
    globalThis.fetch = m.fn;
    await shopForge(env, DID, { rkeys: ['a', 'b'], rkey: 'f1' }, NOW);
    const again = await shopForge(env, DID, { rkeys: ['a', 'b'], rkey: 'f1' }, NOW);
    expect(again.duplicate).toBe(true);
    expect(stored(m.store).pieces).toEqual([{ rkey: 'f1', itemId: ITEM.id, level: 2 }]);
  });

  it('制作すると所持個体が権威側に増える', async () => {
    const env = await makeEnv();
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    const r = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    expect(stored(m.store).pieces).toEqual([{ rkey: 'c1', itemId: ITEM.id, level: r.level }]);
  });
});

describe('sanitizeGear (持っていない装備は着られない)', () => {
  it('所持していない品は落とす', () => {
    // それまでは client の申告を無検証で保存していたので、これだけで戦闘に効いた
    expect(sanitizeGear({ weapon: { id: 'wp-shogun-high', level: 99 } }, [])).toEqual({});
  });

  it('持っていても、その強化値の個体が無ければ落とす', () => {
    const mine = [{ rkey: 'a', itemId: ITEM.id, level: 1 }];
    expect(sanitizeGear({ armor: { id: ITEM.id, level: 9 } }, mine)).toEqual({});
    expect(sanitizeGear({ armor: { id: ITEM.id, level: 1 } }, mine)).toEqual({ armor: { id: ITEM.id, level: 1 } });
  });

  it('強化値の指定が無い旧形式は、持っている中でいちばん低い個体で通す', () => {
    const mine = [{ rkey: 'a', itemId: ITEM.id, level: 3 }, { rkey: 'b', itemId: ITEM.id, level: 1 }];
    expect(sanitizeGear({ armor: ITEM.id }, mine)).toEqual({ armor: { id: ITEM.id, level: 1 } });
  });
});

describe('素ステの正規化 (#551 段階 3)', () => {
  it('盛った素ステは形だけ残り、大きさは正規化される', async () => {
    const { normalizeStats } = await import('@aozoraquest/core');
    // analysis はユーザー自身の PDS にあり本人が自由に書ける。そのまま信じると
    // {atk: 9999} で戦闘力を盛れた。正当な診断結果は必ず合計 100 になるので、
    // 同じ正規化を掛ければ形は残って大きさだけ盛れなくなる。
    const cheated = normalizeStats({ atk: 9999, def: 1, agi: 1, int: 1, luk: 1 });
    const sum = cheated.atk + cheated.def + cheated.agi + cheated.int + cheated.luk;
    expect(sum).toBe(100);
    expect(cheated.atk).toBe(100); // 形 (atk 寄り) は残る
    // 正当な値はそのまま (べき等)
    const honest = { atk: 3, def: 19, agi: 45, int: 9, luk: 24 };
    expect(normalizeStats(honest)).toEqual(honest);
  });
});

describe('レビュー指摘の回帰 (#551)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('再送でも強化値が返る (「+0」になって装備が弱くならない)', async () => {
    // duplicate で level 0 を返していた頃は、再試行した装備が +0 として表示・装備され、
    // リロードすると本来の値に化けた。
    const env = await makeEnv();
    const m = statefulPds(stateAt());
    globalThis.fetch = m.fn;
    const first = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    const again = await shopCraft(env, DID, { itemId: ITEM.id, rkey: 'c1', luk: 10 }, NOW);
    expect(again.duplicate).toBe(true);
    expect(again.level).toBe(first.level);
  });

  it('街から出たあとは買えない (位置は署名トークンが優先)', async () => {
    // GameState.x/y は「街に入ったとき」しか書かれないので、野外に歩き出しても
    // 街の座標が残る = どこからでも買えた。
    const env = await makeEnv();
    globalThis.fetch = statefulPds(stateAt()).fn;
    await expect(
      shopCraft(env, DID, { itemId: ITEM.id, rkey: 'p1', luk: 0, pos: { x: TOWN.x + 9, y: TOWN.y + 9 } }, NOW),
    ).rejects.toMatchObject({ code: 'not_in_town' });
  });
});
