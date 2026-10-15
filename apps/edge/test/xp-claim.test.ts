import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { XP_REWARDS, jobLevelFromXp } from '@aozoraquest/core';
import { claimXp, adminSetJobXp, adminGrantPower, POWER_PER_POST, XpClaimError } from '../src/xp-claim';
import { normalizeState, rkeyForDid, readState, XP_EPOCH, type GameState, type GameStateEnv } from '../src/game-state';
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
/** getRecord + putRecord (swapRecord CAS) を実装した PDS モック。 */
function statefulPds() {
  const store = new Map<string, { value: unknown; cid: string }>();
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
      const cid = `cid${++counter}`;
      store.set(b.rkey, { value: b.record, cid });
      return json(200, { uri: `at://${b.rkey}`, cid });
    }
    return json(404, { error: 'not_found' });
  }) as unknown as typeof fetch;
  return { fn, store };
}
const stored = (store: Map<string, { value: unknown; cid: string }>) => store.get(rkeyForDid(DID))!.value as GameState;

/** 投稿レコードを返す PDS モック (実在検証を通すため)。 */
function pdsWithPost(store: Map<string, { value: unknown; cid: string }>, opts: { exists?: boolean; createdAt?: string } = {}) {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  let counter = 0;
  return (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory') || url.includes('did.json')) {
      return json(200, { id: DID, alsoKnownAs: ['at://alice.test'], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }] });
    }
    if (url.includes('com.atproto.repo.getRecord')) {
      const u = new URL(url);
      const col = u.searchParams.get('collection')!;
      if (col === 'app.bsky.feed.post') {
        if (opts.exists === false) return json(400, { error: 'RecordNotFound' });
        return json(200, { uri: 'x', cid: 'p', value: { text: 'hi', createdAt: opts.createdAt ?? new Date(NOW * 1000).toISOString() } });
      }
      const rkey = u.searchParams.get('rkey')!;
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
}
const postUri = (rkey: string, owner = DID) => `at://${owner}/app.bsky.feed.post/${rkey}`;

describe('claimXp (投稿の申告)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('額はサーバーが決める (client は投稿の URI しか送らない)', async () => {
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    globalThis.fetch = pdsWithPost(store);
    const r = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a') }, NOW);
    // 初回は 投稿ぶん + 日次ボーナス + streak 1 日ぶん
    expect(r.granted).toBe(XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusPerDay);
    expect(r.streakDays).toBe(1);
  });

  it('同じ日の 2 件目以降は投稿ぶんだけ。**回数に上限は無い**', async () => {
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    let t = NOW - 3600;
    const fetchAt = () => { globalThis.fetch = pdsWithPost(store, { createdAt: new Date((t += 1) * 1000).toISOString() }); };
    fetchAt(); await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a') }, NOW);
    let total = 0;
    for (let i = 0; i < 50; i++) {
      fetchAt();
      total += (await claimXp(env, DID, { archetype: 'warrior', postUri: postUri(`p${i}`) }, NOW)).granted;
    }
    // 投稿が実在するなら何件でも入る (日次上限で正直な人を罰しない)
    expect(total).toBe(XP_REWARDS.postMatch * 50);
  });

  it('**存在しない投稿では入らない**', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsWithPost(new Map(), { exists: false });
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: postUri('ghost') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });

  it('**他人の投稿では入らない**', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsWithPost(new Map());
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a', 'did:plc:bob') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });

  it('投稿以外のレコードでは入らない', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsWithPost(new Map());
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: `at://${DID}/app.aozoraquest.analysis/self` }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });

  it('古い投稿では入らない (過去ログを遡って一気に稼げない)', async () => {
    const env = await makeEnv();
    const old = new Date((NOW - 10 * 86400) * 1000).toISOString();
    globalThis.fetch = pdsWithPost(new Map(), { createdAt: old });
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: postUri('old') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });

  it('同じ投稿の再送は積まれない (冪等)', async () => {
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    globalThis.fetch = pdsWithPost(store);
    const first = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a') }, NOW);
    const cidAfterFirst = store.get(rkeyForDid(DID))!.cid;
    const again = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a') }, NOW);
    expect(again.granted).toBe(0);
    expect(again.duplicate).toBe(true);
    expect(again.jobXp).toBe(first.jobXp);
    // **重複は書かない** (#548)。localStorage を失った端末が /me を開くたびに同じ申告を
    // 最大 10 件送るので、中身の変わらないコミットをサーバー repo に積まない。
    expect(store.get(rkeyForDid(DID))!.cid).toBe(cidAfterFirst);
  });

  it('新しい投稿の申告は書く (変更なし判定が本物の申告を落とさない)', async () => {
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    globalThis.fetch = pdsWithPost(store);
    await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('a') }, NOW);
    const cidAfterA = store.get(rkeyForDid(DID))!.cid;
    const b = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('b') }, NOW);
    expect(b.granted).toBe(XP_REWARDS.postMatch);
    expect(store.get(rkeyForDid(DID))!.cid).not.toBe(cidAfterA);
    expect(stored(store).xpClaims).toContain(`post:${postUri('b')}`);
  });

  it('連続日数はサーバーが数える (client の申告を使わない)', async () => {
    const env0 = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    globalThis.fetch = pdsWithPost(store);
    await claimXp(env0, DID, { archetype: 'warrior', postUri: postUri('d1') }, NOW);
    // 翌日 (トークンの期限も伸ばす)
    const day2 = NOW + 86400;
    const kv = mockKv();
    await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: day2 + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: day2 });
    globalThis.fetch = pdsWithPost(store, { createdAt: new Date(day2 * 1000).toISOString() });
    const r2 = await claimXp({ ...env0, OAUTH_TOKENS: kv }, DID, { archetype: 'warrior', postUri: postUri('d2') }, day2);
    expect(r2.streakDays).toBe(2);
  });

  it('投稿でパワーが回復する。**残高に上限は無い**', async () => {
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    let t = NOW - 3600;
    for (let i = 0; i < 30; i++) {
      globalThis.fetch = pdsWithPost(store, { createdAt: new Date((t += 1) * 1000).toISOString() });
      await claimXp(env, DID, { archetype: 'warrior', postUri: postUri(`x${i}`) }, NOW);
    }
    expect((store.get(rkeyForDid(DID))!.value as GameState).power).toBe(30 * POWER_PER_POST);
  });

  it('実在しない職は 400 (権威レコードのキー空間を汚させない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsWithPost(new Map());
    await expect(claimXp(env, DID, { archetype: 'not-a-job', postUri: postUri('a') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });
});

describe('adminSetJobXp (管理者がレベルを直接セット)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('指定レベルちょうどの XP になる (その職の曲線から引く)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    for (const job of ['warrior', 'mage', 'shogun']) {
      const r = await adminSetJobXp(env, DID, job, 30, NOW);
      expect(r.level).toBe(30);
      // 職ごとに曲線が違う (#536) ので、基準曲線で引くと指定と違うレベルになる。
      // セットした XP から引き直したレベルが 30 に一致すること。
      expect(jobLevelFromXp(r.jobXp, job)).toBe(30);
    }
  });

  it('前の値を足すのではなく置き換える (何度押しても同じレベル)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await adminSetJobXp(env, DID, 'warrior', 30, NOW);
    const again = await adminSetJobXp(env, DID, 'warrior', 30, NOW);
    expect(jobLevelFromXp(again.jobXp, 'warrior')).toBe(30);
    const down = await adminSetJobXp(env, DID, 'warrior', 5, NOW);
    expect(jobLevelFromXp(down.jobXp, 'warrior')).toBe(5); // 下げられる
  });

  it('他の職の XP は触らない', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await adminSetJobXp(env, DID, 'mage', 12, NOW);
    const before = stored(m.store).jobXp['mage'];
    await adminSetJobXp(env, DID, 'warrior', 10, NOW);
    expect(stored(m.store).jobXp['mage']).toBe(before);
  });

  it('範囲外のレベルは 400', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds().fn;
    await expect(adminSetJobXp(env, DID, 'warrior', 0, NOW)).rejects.toBeInstanceOf(XpClaimError);
    await expect(adminSetJobXp(env, DID, 'warrior', 999, NOW)).rejects.toBeInstanceOf(XpClaimError);
    await expect(adminSetJobXp(env, DID, '', 10, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });
});



describe('adminGrantPower (管理者のパワー付与)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('権威 state の power が増える', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    const r = await adminGrantPower(env, DID, 100, NOW);
    expect(r.power).toBe(100);
    expect(stored(m.store).power).toBe(100);
  });

  it('負の値で減らせる。0 未満にはならない', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await adminGrantPower(env, DID, 50, NOW);
    expect((await adminGrantPower(env, DID, -20, NOW)).power).toBe(30);
    expect((await adminGrantPower(env, DID, -999, NOW)).power).toBe(0);
  });

  it('XP や持ち物は触らない', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await adminSetJobXp(env, DID, 'warrior', 8, NOW);
    const before = stored(m.store).jobXp['warrior'];
    await adminGrantPower(env, DID, 100, NOW);
    expect(stored(m.store).jobXp['warrior']).toBe(before);
  });
});


describe('レビュー指摘の回帰 (#551)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('**冪等リングが溢れても過去の投稿を再送できない** (無限に回せない)', async () => {
    // リングは直近 200 件しか覚えていないので、201 件申告してから 1 件目を再送すると
    // 通ってしまい、巡回させれば XP もパワーも無限に湧いた (レビューが実際に再現)。
    // 投稿は時間順にしか増えないので「前回より新しい投稿だけ」を通せば全部落ちる。
    const env = await makeEnv();
    const store = new Map<string, { value: unknown; cid: string }>();
    const at = (i: number) => new Date((NOW - 3600 + i) * 1000).toISOString();
    let cur = 0;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      (pdsWithPost(store, { createdAt: at(cur) }) as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)) as unknown as typeof fetch;
    for (let i = 0; i < 205; i++) { cur = i; await claimXp(env, DID, { archetype: 'warrior', postUri: postUri(`p${i}`) }, NOW); }
    const before = (store.get(rkeyForDid(DID))!.value as GameState).jobXp['warrior'];
    // 1 件目を再送 (リングからは押し出されている)
    cur = 0;
    const replay = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('p0') }, NOW);
    expect(replay.granted).toBe(0);
    expect(replay.duplicate).toBe(true);
    expect((store.get(rkeyForDid(DID))!.value as GameState).jobXp['warrior']).toBe(before);
  });

  it('**日次ボーナスは JST の 1 日で 1 回**', async () => {
    // UTC で切ると 09:00 JST が境界になり、「朝 8 時 → 10 時」で 2 回付いた。
    const store = new Map<string, { value: unknown; cid: string }>();
    const jst = (h: number) => Math.floor(Date.UTC(2026, 10, 17, h - 9, 0, 0) / 1000); // JST h 時
    const morning = jst(8);
    const later = jst(10);
    const kv = mockKv();
    await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: later + 3600, pdsUrl: PDS, authServer: 'https://bsky.social', updatedAt: morning });
    const env: GameStateEnv = { ...(await makeEnv()), OAUTH_TOKENS: kv };
    globalThis.fetch = pdsWithPost(store, { createdAt: new Date(morning * 1000).toISOString() });
    const a = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('m1') }, morning);
    globalThis.fetch = pdsWithPost(store, { createdAt: new Date(later * 1000).toISOString() });
    const b = await claimXp(env, DID, { archetype: 'warrior', postUri: postUri('m2') }, later);
    expect(a.granted).toBeGreaterThan(XP_REWARDS.postMatch); // 初回はボーナスつき
    expect(b.granted).toBe(XP_REWARDS.postMatch); // 同じ JST 日なのでボーナス無し
    expect(b.streakDays).toBe(a.streakDays);
  });

  it('**createdAt が読めない投稿は拒否**する (省略するだけで年齢チェックを飛ばせた)', async () => {
    const env = await makeEnv();
    globalThis.fetch = pdsWithPost(new Map(), { createdAt: 'not-a-date' });
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: postUri('bad') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });

  it('未来の日時の投稿は拒否する', async () => {
    const env = await makeEnv();
    const future = new Date((NOW + 86400) * 1000).toISOString();
    globalThis.fetch = pdsWithPost(new Map(), { createdAt: future });
    await expect(claimXp(env, DID, { archetype: 'warrior', postUri: postUri('fut') }, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });
});
