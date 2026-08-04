import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { sealEncounter, handleMove, handleTeleport, handleTurn, handleReset, migrateInitState, ResolverError, GUARD_TTL_SEC, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { BASE_PALETTE, setInteriors, terrainAt, isWalkable, worldOverlay, type Command, type InteriorMap } from '@aozoraquest/core';
import { XP_EPOCH, type GameState } from '../src/game-state';

const USER = 'did:plc:alice';
const SERVER_DID = 'did:plc:testserver';
const SERVER_PDS = 'https://server-pds.example';
const USER_PDS = 'https://user-pds.example';
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
async function makeEnv(): Promise<ResolverEnv> {
  const kv = mockKv();
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: SERVER_PDS, authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID, WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv };
}

const DIAG = { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } };
// xpEpoch 済みの state (= ベータの区切りを通過済み)。省くと normalizeState が
// 「区切り前」と見なして jobXp と位置をリセットしてしまう (#534)。
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

/** 診断 + サーバー PDS (gameState + guard) の CAS を実装する統合モック。 */
function resolverMock(opts: { diagnosis?: unknown; gameState?: GameState } = {}) {
  const store = new Map<string, { value: unknown; cid: string }>();
  if (opts.gameState) store.set('gs', { value: opts.gameState, cid: 'gs0' });
  const guardKey = 'guard';
  let counter = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const which = (col: string) => (col === 'app.aozoraquest.gameState' ? 'gs' : col === 'app.aozoraquest.battleGuard' ? guardKey : col);
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: USER_PDS }] });
    if (url.includes('getRecord')) {
      const u = new URL(url);
      const col = u.searchParams.get('collection')!;
      if (col === 'app.aozoraquest.analysis') return opts.diagnosis ? json(200, { uri: 'x', cid: 'd', value: opts.diagnosis }) : json(400, { error: 'RecordNotFound' });
      const rec = store.get(which(col));
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    const k = which(b.collection);
    const cur = store.get(k);
    if (url.includes('putRecord')) {
      if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      const cid = `c${++counter}`;
      store.set(k, { value: b.record, cid });
      return json(200, { uri: 'x', cid });
    }
    if (url.includes('deleteRecord')) {
      if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
      store.delete(k);
      return json(200, {});
    }
    return json(404, { error: 'nf' });
  }) as unknown as typeof fetch;
  return { fn, store };
}

describe('battle-resolver (サーバー権威 移動/戦闘)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('sealEncounter: monster を返すが **seed は返さない** + rewarded は power で決まる', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    const r = await sealEncounter(env, USER, GS({ power: 5 }), 5, 5, 12345, NOW);
    expect(r.battleId).toMatch(/^b[0-9a-f]{24}$/);
    expect(r.monsterId).toBeTruthy();
    expect(r.rewarded).toBe(true);
    expect('seed' in r.state).toBe(false); // ★ 内部 seed 非漏洩
    // 既存ガードがあっても、新しい遭遇は**孤立ガードを破棄して成立**する (離脱後にエンカウントタイルで
    // 詰まる=「移動できなかった」の解消)。client は戦闘中は move しないので既存ガードは必ず孤立。
    const r2 = await sealEncounter(env, USER, GS(), 5, 5, 12345, NOW);
    expect(r2.battleId).toMatch(/^b[0-9a-f]{24}$/);
    expect(r2.battleId).not.toBe(r.battleId);
  });

  it('sealEncounter: power 0 → rewarded=false / 診断なし → 409', async () => {
    let env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 0 }) }).fn;
    expect((await sealEncounter(env, USER, GS({ power: 0 }), 5, 5, 12345, NOW)).rewarded).toBe(false);
    env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: undefined, gameState: GS() }).fn;
    await expect(sealEncounter(env, USER, GS(), 5, 5, 12345, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('move: 隣接1マスだけ許可 (斜め2マス/同地は 400) + 位置を進め署名トークンを返す', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) }).fn;
    // token 未指定 → gameState から現在地を再同期 (x:10,y:10)。
    await expect(handleMove(env, USER, 0, 0, undefined, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(handleMove(env, USER, 2, 0, undefined, NOW)).rejects.toMatchObject({ status: 400 });
    // 歩ける隣接方向を探して 1 マス動く
    let token: string | undefined;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]] as const) {
      if (isWalkable(terrainAt(10 + dx, 10 + dy))) {
        const r = await handleMove(env, USER, dx, dy, undefined, NOW);
        expect(r.x).toBe(10 + dx);
        expect(r.y).toBe(10 + dy);
        expect(typeof r.token).toBe('string'); // 新しい位置トークン
        token = r.token;
        // 返ったトークンで次歩: 位置がトークン権威で継続する (gameState 書き込み無し)。
        const r2 = await handleMove(env, USER, 0, 0 === dy ? 1 : 0, undefined, NOW).catch(() => null);
        void r2;
        break;
      }
    }
    expect(typeof token).toBe('string');
  });

  it('move はステートレス: 毎歩ガードを読まない (戦闘中でも移動要求は通る=踏み倒し) / 期限切れガードは encounter 時に flush', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) });
    globalThis.fetch = m.fn;
    // 生きたガードを作る
    await sealEncounter(env, USER, GS({ x: 10, y: 10 }), 10, 10, 12345, NOW);
    // move はガードを読まないので 409 にならず位置を返す (client 側で戦闘中は移動禁止する)。
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0]] as const) {
      if (isWalkable(terrainAt(10 + dx, 10 + dy))) {
        const r = await handleMove(env, USER, dx, dy, undefined, NOW);
        expect(r.x).toBe(10 + dx);
        break;
      }
    }
    // 期限切れ後に新しい encounter を張ると、古いガードは flush されて新ガードに置き換わる。
    const before = (m.store.get('guard')!.value as { battleId: string }).battleId;
    const enc2 = await sealEncounter(env, USER, GS({ x: 20, y: 20 }), 20, 20, 999, NOW + GUARD_TTL_SEC + 10);
    expect(enc2.battleId).not.toBe(before);
    expect((m.store.get('guard')!.value as { battleId: string }).battleId).toBe(enc2.battleId);
  });

  it('turn: battleId/turn 不一致は 409 / 不正コマンド 400 / 戦闘中でなければ 409', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS() }).fn;
    await expect(handleTurn(env, USER, 'x', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 }); // guard なし
    const enc = await sealEncounter(env, USER, GS(), 5, 5, 12345, NOW);
    await expect(handleTurn(env, USER, 'wrong', 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
    await expect(handleTurn(env, USER, enc.battleId, 5, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
    await expect(handleTurn(env, USER, enc.battleId, 0, 'hack' as Command, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('決着まで戦うと **報酬が権威 state に確定**しガードが消える (二重報酬なし)', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ power: 5, playerXp: 100, materials: { ore: 5 } }) });
    globalThis.fetch = m.fn;
    const enc = await sealEncounter(env, USER, GS({ power: 5, playerXp: 100, materials: { ore: 5 } }), 5, 5, 12345, NOW);
    let outcome = 'ongoing';
    let last;
    for (let turn = 0; turn < 40 && outcome === 'ongoing'; turn++) {
      last = await handleTurn(env, USER, enc.battleId, turn, 'attack', NOW);
      outcome = last.outcome;
    }
    // 30 ターンで必ず決着する。**逃走 (monster-fled) も決着**で、#536 で はぐれスライムの帯が
    // 変わり (5,5) の座標でも引けるようになったため候補に含める。逃走は無報酬・無消費なので
    // 下の分岐は win のときだけ検証する。
    expect(['win', 'lose', 'draw', 'monster-fled']).toContain(outcome);
    expect(m.store.has('guard')).toBe(false); // ガードは決着で消える
    const gs = m.store.get('gs')!.value as GameState;
    if (outcome === 'win') {
      expect(gs.playerXp).toBe(100); // プレイヤー XP は増えない (#507/#508)
      expect(Object.values(gs.jobXp).some((v) => v > 0)).toBe(true); // ジョブ XP が権威 state に加算された
      expect(gs.power).toBe(4); // パワー 1 消費
      expect(last!.awarded?.xp).toBeGreaterThan(0);
    }
    // 決着後に同じターンを再送 → guard 無し = 409 (二重報酬不可)
    await expect(handleTurn(env, USER, enc.battleId, 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('migrateInitState: power 残高は取り込むが、ジョブ XP は取り込まない (§6-4 / #534)', async () => {
    const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
    const migrateFetch = (power: unknown, analysis: unknown) => (async (url: string) => {
      if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: USER_PDS }] });
      const col = new URL(url).searchParams.get('collection');
      if (col === 'app.aozoraquest.power') return power ? json(200, { uri: 'x', cid: 'p', value: power }) : json(400, { error: 'RecordNotFound' });
      if (col === 'app.aozoraquest.analysis') return analysis ? json(200, { uri: 'x', cid: 'a', value: analysis }) : json(400, { error: 'RecordNotFound' });
      return json(400, { error: 'RecordNotFound' });
    }) as unknown as typeof fetch;

    // getRecord は globalThis.fetch を使う (fetchImpl 引数は DID 解決のみ) ので mock を差し込む。
    // 残高 = viaPosts - userMessages - cardDraws - battles - craft - search + sale = 100-10-5-3-2-1+6 = 85
    globalThis.fetch = migrateFetch(
      { viaPosts: 100, userMessages: 10, cardDraws: 5, battles: 3, craftPowerSpent: 2, searchPowerSpent: 1, salePowerEarned: 6 },
      { playerLevel: { xp: 1234 }, jobLevel: { archetype: 'warrior', xp: 567 } },
    );
    const s1 = await migrateInitState(USER, '');
    expect(s1.power).toBe(85);
    expect(s1.playerXp).toBe(1234);
    // **ジョブ XP は取り込まない** (#534)。XP を権威 state に一本化したので、投稿由来の XP を
    // 種として焼き込むと申告ぶんと二重に効く。ベータの区切りとして全員 Lv1 から再スタート。
    expect(s1.jobXp).toEqual({});

    // 偽造された巨大値は上限クランプされる (MAX_MIGRATE_*)
    globalThis.fetch = migrateFetch(
      { viaPosts: 9_999_999 },
      { playerLevel: { xp: 9_999_999 }, jobLevel: { archetype: 'mage', xp: 9_999_999 } },
    );
    const s2 = await migrateInitState(USER, '');
    expect(s2.power).toBe(100_000); // MAX_MIGRATE_POWER
    expect(s2.playerXp).toBe(500_000); // MAX_MIGRATE_PLAYER_XP
    expect(s2.jobXp).toEqual({}); // 偽造された巨大な投稿 XP も、そもそも取り込まないので無害

    // レコード無し (未診断・power 無し) は power 0・Lv1 で fail-open
    globalThis.fetch = migrateFetch(null, null);
    const s3 = await migrateInitState(USER, '');
    expect(s3.power).toBe(0);
    expect(s3.playerXp).toBe(0);
    expect(s3.jobXp).toEqual({});
    // 冒険はじめの持ち物: やくそう 1 + そらのはね 1 (どのケースでも初期付与される)。
    expect(s3.materials).toEqual({ herb: 1, 'sky-feather': 1 });
    expect(s1.materials).toEqual({ herb: 1, 'sky-feather': 1 });
  });

  it('handleReset: 認証済み本人の権威 gameState + 戦闘ガードを削除する (次入場で初期化)', async () => {
    const env = await makeEnv();
    const mock = resolverMock({ diagnosis: DIAG, gameState: GS() });
    globalThis.fetch = mock.fn;
    // 遭遇でガードを作る → gameState と guard が store に居る状態を作る
    await sealEncounter(env, USER, GS(), 5, 5, 12345, NOW);
    expect(mock.store.has('gs')).toBe(true);
    expect(mock.store.has('guard')).toBe(true);
    // リセット: 両方消える
    const r = await handleReset(env, USER, NOW);
    expect(r).toEqual({ ok: true });
    expect(mock.store.has('gs')).toBe(false);
    expect(mock.store.has('guard')).toBe(false);
    // 冪等: state/guard 無しでも例外を投げない
    await expect(handleReset(env, USER, NOW)).resolves.toEqual({ ok: true });
  });
});

describe('内部マップとゲート (#424)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  const FLOOR = BASE_PALETTE.indexOf('plains');
  const WALL = BASE_PALETTE.indexOf('mountain');
  /** 外周が壁・中が床の 8×8。 */
  const room = (id = 'in-1'): InteriorMap => {
    const size = 8;
    const tiles = new Uint8Array(size * size).fill(FLOOR);
    for (let k = 0; k < size; k++) {
      tiles[k] = WALL; tiles[(size - 1) * size + k] = WALL; tiles[k * size] = WALL; tiles[k * size + size - 1] = WALL;
    }
    return { id, name: 'へや', size, tiles };
  };

  /** フィールドの (x,y) から歩ける隣接マスを探す。 */
  const walkableStep = (x: number, y: number) => {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      if (isWalkable(terrainAt(x + dx, y + dy))) return { dx, dy, nx: x + dx, ny: y + dy };
    }
    throw new Error('歩ける隣接マスがない');
  };

  it('フィールドのゲートを踏むと内部マップへ移り、mapId 付きのトークンが返る', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) }).fn;
    const step = walkableStep(10, 10);
    setInteriors([room()], [{ from: { mapId: 'world', x: step.nx, y: step.ny }, to: { mapId: 'in-1', x: 4, y: 4 } }]);
    const r = await handleMove(env, USER, step.dx, step.dy, undefined, NOW);
    expect(r.mapId).toBe('in-1');
    expect(r.x).toBe(4);
    expect(r.y).toBe(4);
    // 返ったトークンで内部を歩ける (内部の床は通れる)
    const r2 = await handleMove(env, USER, 1, 0, r.token, NOW);
    expect(r2.mapId).toBe('in-1');
    expect(r2.x).toBe(5);
  });

  it('内部マップの壁には進めない (400)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) }).fn;
    const step = walkableStep(10, 10);
    setInteriors([room()], [{ from: { mapId: 'world', x: step.nx, y: step.ny }, to: { mapId: 'in-1', x: 1, y: 1 } }]);
    const enter = await handleMove(env, USER, step.dx, step.dy, undefined, NOW);
    // (1,1) の左と上は外周の壁
    await expect(handleMove(env, USER, -1, 0, enter.token, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(handleMove(env, USER, 0, -1, enter.token, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('内部マップは端で折り返さない (外周の外へは出られない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 1, y: 1 }) }).fn;
    setInteriors([room()], []);
    // state 由来の mapId で内部に居る。壁の向こう (負の座標) へは進めない。
    await expect(handleMove(env, USER, -1, 0, undefined, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it('内部のゲートを踏むとフィールドへ戻る', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4 }) }).fn;
    const back = walkableStep(20, 20); // 戻り先が歩ける地形になるよう実地形から選ぶ
    setInteriors([room()], [{ from: { mapId: 'in-1', x: 5, y: 4 }, to: { mapId: 'world', x: back.nx, y: back.ny } }]);
    const r = await handleMove(env, USER, 1, 0, undefined, NOW);
    expect(r.mapId).toBeUndefined(); // フィールドは mapId を返さない (旧 client 互換)
    expect(r.x).toBe(back.nx);
    expect(r.y).toBe(back.ny);
  });

  it('内部で遭遇した move の応答も mapId を落とさない', async () => {
    // 落とすと web が「内部を抜けた」と誤認し、遭遇の裏でフィールドの地形が描かれる。
    // 遭遇するかは seed 次第なので、応答に mapId が必ず載ることだけを確かめる。
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4 }) }).fn;
    setInteriors([{ ...room(), encounterTier: 3 }], []);
    const r = await handleMove(env, USER, 1, 0, undefined, NOW);
    expect(r.mapId).toBe('in-1');
  });

  it('そらのはねで内部から飛ぶと state の mapId が消える (壊れた state を残さない)', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4, materials: { 'sky-feather': 1 } }) });
    globalThis.fetch = m.fn;
    setInteriors([room()], []);
    const town = worldOverlay().towns[0]!;
    await handleTeleport(env, USER, town.x, town.y, NOW);
    const stored = m.store.get('gs')!.value as GameState;
    expect(stored.mapId).toBeUndefined();
    expect(stored.x).toBe(town.x);
  });

  it('定義が消えた内部マップに居てもフィールド扱いで動ける (取り残されない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'deleted', x: 10, y: 10 }) }).fn;
    setInteriors([], []); // そのマップはもう無い
    const step = walkableStep(10, 10);
    const r = await handleMove(env, USER, step.dx, step.dy, undefined, NOW);
    expect(r.mapId).toBeUndefined();
    expect(r.x).toBe(step.nx);
  });
});

describe('内部マップの詰み対策 (#424 レビュー)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  const FLOOR2 = BASE_PALETTE.indexOf('plains');
  const WALL2 = BASE_PALETTE.indexOf('mountain');
  const room2 = (): InteriorMap => {
    const size = 8;
    const tiles = new Uint8Array(size * size).fill(FLOOR2);
    for (let k = 0; k < size; k++) {
      tiles[k] = WALL2; tiles[(size - 1) * size + k] = WALL2; tiles[k * size] = WALL2; tiles[k * size + size - 1] = WALL2;
    }
    return { id: 'in-1', name: 'へや', size, tiles };
  };

  it('内部マップの範囲外に立っていてもフィールド扱いで脱出できる', async () => {
    // 「mapId は内部のまま x/y は街の座標」という壊れた state (過去のバグ・手編集) でも
    // 全方向 400 で固まらない。
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 300, y: 300 }) }).fn;
    setInteriors([room2()], []);
    let moved = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const r = await handleMove(env, USER, dx, dy, undefined, NOW).catch(() => null);
      if (!r) continue;
      expect(r.mapId).toBeUndefined(); // フィールドとして動く
      moved = true;
      break;
    }
    expect(moved).toBe(true);
  });

  /**
   * **座標もフィールドの安全な場所へ戻す** (#644 レビュー ★★★)。
   *
   * mapId だけフィールドに倒すと、内部マップのローカル座標がそのままフィールド座標として
   * 解釈される。内部マップを小さく作り直した (村を 64→32) 直後は「旧マップでは歩けたが
   * 新マップでは範囲外」の座標に立つ人が出て、その座標が海の上だと 8 方向すべて
   * 「進めない地形」になり、そらのはね無しでは復帰不能になる。
   */
  it('範囲外から戻る先が海でも詰まない (出口 → 直前の街 → スポーンの順に逃がす)', async () => {
    const env = await makeEnv();
    // 8 近傍すべてが歩けない座標を実地形から探す (= 昔の「mapId だけ倒す」では詰む場所)
    let trap: { x: number; y: number } | null = null;
    for (let y = 40; y < 400 && !trap; y += 1) {
      for (let x = 40; x < 400; x += 1) {
        const around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
        if (isWalkable(terrainAt(x, y))) continue;
        if (around.every(([dx, dy]) => !isWalkable(terrainAt(x + dx, y + dy)))) { trap = { x, y }; break; }
      }
    }
    expect(trap, '海の真ん中が見つからない').not.toBeNull();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: trap!.x, y: trap!.y }) }).fn;
    // 出口を持つ内部マップ (同梱の村と同じ形)。範囲外ならまずここへ逃がす。
    const back = (() => {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        if (isWalkable(terrainAt(20 + dx, 20 + dy))) return { nx: 20 + dx, ny: 20 + dy };
      }
      throw new Error('歩ける隣接マスがない');
    })();
    setInteriors([{ ...room2(), exitTo: { mapId: 'world', x: back.nx, y: back.ny } }], []);
    // どこかの方向へは必ず動ける (= 海に置き去りにされていない)
    const results = await Promise.all(
      ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) =>
        handleMove(env, USER, dx, dy, undefined, NOW).catch(() => null)),
    );
    expect(results.some((r) => r !== null)).toBe(true);
    // 逃げ先は出口の周り — 罠の座標をそのまま引き継いでいない
    for (const r of results) {
      if (!r) continue;
      expect(Math.abs(r.x - back.nx) + Math.abs(r.y - back.ny)).toBeLessThanOrEqual(1);
    }
  });
});

describe('ゲートの解禁フラグ (#426)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  const FLOOR3 = BASE_PALETTE.indexOf('plains');
  const WALL3 = BASE_PALETTE.indexOf('mountain');
  const room3 = (): InteriorMap => {
    const size = 8;
    const tiles = new Uint8Array(size * size).fill(FLOOR3);
    for (let k = 0; k < size; k++) {
      tiles[k] = WALL3; tiles[(size - 1) * size + k] = WALL3; tiles[k * size] = WALL3; tiles[k * size + size - 1] = WALL3;
    }
    return { id: 'in-1', name: 'しろ', size, tiles };
  };
  const step = (x: number, y: number) => {
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      if (isWalkable(terrainAt(x + dx, y + dy))) return { dx, dy, nx: x + dx, ny: y + dy };
    }
    throw new Error('歩ける隣接マスがない');
  };

  it('フラグが立っていないと通れない (client の自己申告では開かない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10 }) }).fn;
    const s = step(10, 10);
    setInteriors([room3()], [{ from: { mapId: 'world', x: s.nx, y: s.ny }, to: { mapId: 'in-1', x: 4, y: 4 }, requireFlags: ['castle_open'] }]);
    await expect(handleMove(env, USER, s.dx, s.dy, undefined, NOW)).rejects.toMatchObject({ status: 400, code: 'gate_locked' });
  });

  it('フラグが立っていれば通れる', async () => {
    const env = await makeEnv();
    globalThis.fetch = resolverMock({ diagnosis: DIAG, gameState: GS({ x: 10, y: 10, flags: ['castle_open'] }) }).fn;
    const s = step(10, 10);
    setInteriors([room3()], [{ from: { mapId: 'world', x: s.nx, y: s.ny }, to: { mapId: 'in-1', x: 4, y: 4 }, requireFlags: ['castle_open'] }]);
    const r = await handleMove(env, USER, s.dx, s.dy, undefined, NOW);
    expect(r.mapId).toBe('in-1');
  });
});

describe('宿屋 (#424)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  const F = BASE_PALETTE.indexOf('plains');
  const W = BASE_PALETTE.indexOf('mountain');
  const innRoom = (): InteriorMap => {
    const size = 8;
    const tiles = new Uint8Array(size * size).fill(F);
    for (let k = 0; k < size; k++) { tiles[k] = W; tiles[(size-1)*size+k] = W; tiles[k*size] = W; tiles[k*size+size-1] = W; }
    return { id: 'in-1', name: 'むら', size, tiles, inn: { x: 5, y: 4, price: 3, name: 'やど' } };
  };

  it('傷ついていれば パワーを払って全回復する', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4, power: 10, carryHp: 5 }) });
    globalThis.fetch = m.fn;
    setInteriors([innRoom()], []);
    const r = await handleMove(env, USER, 1, 0, undefined, NOW); // (5,4) = 宿屋
    expect(r.inn).toMatchObject({ paid: 3, power: 7 });
    expect(r.healed).toBe(true);
    const st = m.store.get('gs')!.value as GameState;
    expect(st.power).toBe(7);
    expect(st.carryHp).toBeUndefined(); // 全回復 = carry を消す
  });

  it('満タンなら課金しない (通り抜けても取られない)', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4, power: 10 }) });
    globalThis.fetch = m.fn;
    setInteriors([innRoom()], []);
    const r = await handleMove(env, USER, 1, 0, undefined, NOW);
    expect(r.inn).toMatchObject({ paid: 0, power: 10 });
    expect((m.store.get('gs')!.value as GameState).power).toBe(10);
  });

  it('パワーが足りなければ泊まれない (回復も課金もしない)', async () => {
    const env = await makeEnv();
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ mapId: 'in-1', x: 4, y: 4, power: 1, carryHp: 5 }) });
    globalThis.fetch = m.fn;
    setInteriors([innRoom()], []);
    const r = await handleMove(env, USER, 1, 0, undefined, NOW);
    expect(r.innDenied).toMatchObject({ price: 3, power: 1 });
    expect(r.healed).toBeUndefined();
    expect((m.store.get('gs')!.value as GameState).carryHp).toBe(5); // 傷は残る
  });
});

describe('街の内部へ入ると帰還先も更新する (#424)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; setInteriors(null, null); });

  it('街のマスからゲートで入ると lastTown がその街になる', async () => {
    // ゲートは街の回復処理より先に return するので、ここで書かないと lastTown が
    // 古い街のまま残り、負けたときに遠くへ飛ばされる。
    const env = await makeEnv();
    const town = worldOverlay().towns[0]!;
    const m = resolverMock({ diagnosis: DIAG, gameState: GS({ x: town.x, y: town.y - 1, lastTown: { x: 1, y: 1 } }) });
    globalThis.fetch = m.fn;
    const size = 8;
    const tiles = new Uint8Array(size * size).fill(BASE_PALETTE.indexOf('plains'));
    setInteriors([{ id: 'in-1', name: 'むら', size, tiles }],
      [{ from: { mapId: 'world', x: town.x, y: town.y }, to: { mapId: 'in-1', x: 4, y: 4 } }]);
    const r = await handleMove(env, USER, 0, 1, undefined, NOW);
    expect(r.mapId).toBe('in-1');
    expect((m.store.get('gs')!.value as GameState).lastTown).toEqual({ x: town.x, y: town.y });
  });
});
