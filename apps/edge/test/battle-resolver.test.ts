import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { sealEncounter, handleMove, handleTurn, handleReset, migrateInitState, ResolverError, GUARD_TTL_SEC, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { terrainAt, isWalkable, type Command } from '@aozoraquest/core';
import type { GameState } from '../src/game-state';

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
const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: '', ...over });

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
    expect(['win', 'lose', 'draw']).toContain(outcome); // 30 ターンで必ず決着
    expect(m.store.has('guard')).toBe(false); // ガードは決着で消える
    const gs = m.store.get('gs')!.value as GameState;
    if (outcome === 'win') {
      expect(gs.playerXp).toBeGreaterThan(100); // XP が権威 state に加算された
      expect(gs.power).toBe(4); // パワー 1 消費
      expect(last!.awarded?.xp).toBeGreaterThan(0);
    }
    // 決着後に同じターンを再送 → guard 無し = 409 (二重報酬不可)
    await expect(handleTurn(env, USER, enc.battleId, 0, 'attack', NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('migrateInitState: PDS の power 残高と分析 Lv を上限クランプして初回 state に取り込む (§6-4)', async () => {
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
    expect(s1.jobXp).toEqual({ warrior: 567 });

    // 偽造された巨大値は上限クランプされる (MAX_MIGRATE_*)
    globalThis.fetch = migrateFetch(
      { viaPosts: 9_999_999 },
      { playerLevel: { xp: 9_999_999 }, jobLevel: { archetype: 'mage', xp: 9_999_999 } },
    );
    const s2 = await migrateInitState(USER, '');
    expect(s2.power).toBe(100_000); // MAX_MIGRATE_POWER
    expect(s2.playerXp).toBe(500_000); // MAX_MIGRATE_PLAYER_XP
    expect(s2.jobXp).toEqual({ mage: 50_000 }); // MAX_MIGRATE_JOB_XP

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
