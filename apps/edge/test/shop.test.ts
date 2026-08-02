import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { EQUIPMENT_BY_ID, SALE_TUNING, townShopStock, worldOverlay, BASE_PALETTE, setInteriors, type InteriorMap } from '@aozoraquest/core';
import { shopCraft, shopSell, shopForge, shopDiscard, ShopError, MAX_SHOP_OPS, MAX_OWNED_PIECES } from '../src/shop';
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

describe('所持上限と すてる (#575)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  const fullPieces = () =>
    Array.from({ length: MAX_OWNED_PIECES }, (_, i) => ({ rkey: `p${i}`, itemId: ITEM.id, level: 0 }));

  it('上限に達したら制作を断る (黙って古い個体を消さない)', async () => {
    const pieces = fullPieces();
    const { fn, store } = statefulPds(stateAt({ pieces }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await expect(shopCraft(env, DID, { itemId: ITEM.id, rkey: 'new', luk: 10, pos: { x: TOWN.x, y: TOWN.y } }, NOW))
      .rejects.toMatchObject({ code: 'pieces_full' });
    // **1 個も消えていない**こと (リングにして古いものを捨てる実装への退行検知)
    expect(stored(store).pieces).toHaveLength(MAX_OWNED_PIECES);
    expect(stored(store).pieces!.map((x) => x.rkey)).toContain('p0');
    // パワーも引かれていない
    expect(stored(store).power).toBe(999);
  });

  it('上限の 1 つ手前なら作れる (オフバイワンで作れなくなっていない)', async () => {
    const pieces = fullPieces().slice(0, MAX_OWNED_PIECES - 1);
    const { fn, store } = statefulPds(stateAt({ pieces }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await shopCraft(await Promise.resolve(env), DID, { itemId: ITEM.id, rkey: 'new', luk: 10, pos: { x: TOWN.x, y: TOWN.y } }, NOW);
    expect(stored(store).pieces).toHaveLength(MAX_OWNED_PIECES);
  });

  it('すてると個体が減り、パワーは返らない', async () => {
    const pieces = [
      { rkey: 'a', itemId: ITEM.id, level: 0 },
      { rkey: 'b', itemId: ITEM.id, level: 3 },
      { rkey: 'c', itemId: ITEM.id, level: 1 },
    ];
    const { fn, store } = statefulPds(stateAt({ pieces, power: 50 }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    const r = await shopDiscard(env, DID, { rkeys: ['a', 'c'], rkey: 'd1' }, NOW);
    expect(r.pieces!.map((x) => x.rkey)).toEqual(['b']);
    // **パワーは返らない** (返すと「作る → すてる」でパワーが増える経路になる)
    expect(stored(store).power).toBe(50);
  });

  it('街の外でも すてられる (上限で詰まないため)', async () => {
    const { fn } = statefulPds(stateAt({ pieces: [{ rkey: 'a', itemId: ITEM.id, level: 0 }], x: TOWN.x + 9, y: TOWN.y + 9 }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    const r = await shopDiscard(env, DID, { rkeys: ['a'], rkey: 'd2' }, NOW);
    expect(r.pieces).toEqual([]);
  });

  it('持っていない個体が 1 つでも混ざっていたら全部断る (部分適用しない)', async () => {
    const pieces = [{ rkey: 'a', itemId: ITEM.id, level: 0 }, { rkey: 'b', itemId: ITEM.id, level: 0 }];
    const { fn, store } = statefulPds(stateAt({ pieces }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await expect(shopDiscard(env, DID, { rkeys: ['a', 'zzz'], rkey: 'd3' }, NOW))
      .rejects.toMatchObject({ code: 'not_owned' });
    expect(stored(store).pieces).toHaveLength(2); // a も残っている
  });

  it('同じ rkey で 2 回すてても二重に減らない (冪等)', async () => {
    const pieces = [{ rkey: 'a', itemId: ITEM.id, level: 0 }, { rkey: 'b', itemId: ITEM.id, level: 0 }];
    const { fn, store } = statefulPds(stateAt({ pieces }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await shopDiscard(env, DID, { rkeys: ['a'], rkey: 'd4' }, NOW);
    const again = await shopDiscard(env, DID, { rkeys: ['a'], rkey: 'd4' }, NOW);
    expect(again.duplicate).toBe(true);
    expect(stored(store).pieces!.map((x) => x.rkey)).toEqual(['b']);
  });

  it('きたえるは上限に当たらない (個体が減る操作なので)', async () => {
    const pieces = fullPieces();
    pieces[0] = { rkey: 'x1', itemId: ITEM.id, level: 2 };
    pieces[1] = { rkey: 'x2', itemId: ITEM.id, level: 2 };
    const { fn, store } = statefulPds(stateAt({ pieces }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await shopForge(env, DID, { rkeys: ['x1', 'x2'], rkey: 'f1', pos: { x: TOWN.x, y: TOWN.y } }, NOW);
    expect(stored(store).pieces).toHaveLength(MAX_OWNED_PIECES - 1);
  });

  it('そうび中の個体は すてられない (持っていない装備の補正が戦闘に残らない)', async () => {
    // sanitizeGear は handleGear からしか呼ばれず、戦闘は生の gearSel を使う。
    // ここで通すと **持っていない +5 武器の補正が戦闘・しらべるに乗り続ける**。
    const pieces = [{ rkey: 'w1', itemId: ITEM.id, level: 5 }];
    const { fn, store } = statefulPds(stateAt({ pieces, gearSel: { [ITEM.slot]: { id: ITEM.id, level: 5 } } }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await expect(shopDiscard(env, DID, { rkeys: ['w1'], rkey: 'd9' }, NOW))
      .rejects.toMatchObject({ code: 'equipped' });
    expect(stored(store).pieces).toHaveLength(1);
    expect(stored(store).gearSel).toBeTruthy();
  });

  it('宙に浮いた gearSel は すてる のときに掃除される', async () => {
    // 古いデータで gearSel が既に持っていない個体を指している場合、
    // 別の個体を捨てたついでに掃除して、補正が残らないようにする。
    const pieces = [{ rkey: 'keep', itemId: ITEM.id, level: 0 }, { rkey: 'junk', itemId: ITEM.id, level: 0 }];
    const { fn, store } = statefulPds(stateAt({ pieces, gearSel: { [ITEM.slot]: { id: 'wp-does-not-exist', level: 9 } } }));
    globalThis.fetch = fn;
    const env = await makeEnv();
    await shopDiscard(env, DID, { rkeys: ['junk'], rkey: 'd10' }, NOW);
    expect(stored(store).gearSel).toEqual({});
  });
});

describe('村の中のなんでも屋 (#424/#636)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  const SIZE = 8;
  const SHOP_TILE = { x: 5, y: 4 };
  const village = (): InteriorMap => ({
    id: 'in-town', name: 'むら', size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(BASE_PALETTE.indexOf('plains')),
    shop: { ...SHOP_TILE, town: { x: TOWN.x, y: TOWN.y } },
  });

  it('店のマスに立っていれば、村の中でも作ってもらえる', async () => {
    setInteriors([village()], []);
    const m = statefulPds(stateAt({ mapId: 'in-town', x: 1, y: 1 })); // state の座標は入口のまま
    globalThis.fetch = m.fn;
    // **位置は token が正**。店のマスを指すトークンを渡す。
    const res = await shopCraft(await makeEnv(), DID,
      { itemId: ITEM.id, rkey: 'r1', luk: 0, pos: { ...SHOP_TILE, mapId: 'in-town' } }, NOW);
    expect(res.pieces).toEqual([{ rkey: 'r1', itemId: ITEM.id, level: res.level }]);
  });

  it('村の中でも店のマス以外では買えない', async () => {
    setInteriors([village()], []);
    globalThis.fetch = statefulPds(stateAt({ mapId: 'in-town', x: 1, y: 1 })).fn;
    await expect(shopCraft(await makeEnv(), DID,
      { itemId: ITEM.id, rkey: 'r2', luk: 0, pos: { x: 1, y: 1, mapId: 'in-town' } }, NOW),
    ).rejects.toMatchObject({ code: 'not_in_town' });
  });
});
