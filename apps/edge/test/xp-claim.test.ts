import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { XP_REWARDS } from '@aozoraquest/core';
import { claimXp, maxXpFor, MAX_CLAIM_KEYS, XpClaimError } from '../src/xp-claim';
import { rkeyForDid, type GameState, type GameStateEnv } from '../src/game-state';
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

describe('XP 申告の上限 (maxXpFor)', () => {
  it('投稿は「分類成功 + 日次ボーナス + streak 上限」まで', () => {
    expect(maxXpFor('post')).toBe(XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap);
  });

  it('クエストは承認 1 件ぶんまで', () => {
    expect(maxXpFor('quest')).toBe(XP_REWARDS.questComplete);
  });

  it('上限は報酬定数から導く (数値の書き写しになっていない)', () => {
    // 報酬を変えたら上限も動くこと。片方だけ直すと「正当な申告が切られる」事故になる。
    expect(maxXpFor('post')).toBeGreaterThan(XP_REWARDS.postMatch);
    expect(maxXpFor('quest')).toBeGreaterThan(0);
  });
});

describe('claimXp (クライアント申告 XP)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('申告した XP が jobXp に積まれる', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    const r = await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 35, key: 'rk1' }, NOW);
    expect(r).toEqual({ granted: 35, jobXp: 35, duplicate: false });
    expect(stored(m.store).jobXp).toEqual({ warrior: 35 });
  });

  it('同じキーの再送は積まれない (冪等)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 35, key: 'rk1' }, NOW);
    const again = await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 35, key: 'rk1' }, NOW);
    expect(again).toEqual({ granted: 0, jobXp: 35, duplicate: true });
    expect(stored(m.store).jobXp).toEqual({ warrior: 35 });
  });

  it('種類が違えば同じキーでも別扱い (投稿 rkey とクエスト URI の衝突を避ける)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 10, key: 'same' }, NOW);
    const q = await claimXp(env, DID, { kind: 'quest', archetype: 'warrior', xp: 10, key: 'same' }, NOW);
    expect(q.granted).toBe(10);
    expect(stored(m.store).jobXp).toEqual({ warrior: 20 });
  });

  it('上限を超える申告は切り捨てる (拒否ではない)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    // 「1 投稿で 100 万 XP」が通らないこと。400 で落とすと、報酬定数の解釈が client と
    // ずれたときに正当な申告まで永久に入らなくなるので、切り捨てにしている。
    const r = await claimXp(env, DID, { kind: 'post', archetype: 'mage', xp: 1_000_000, key: 'rk9' }, NOW);
    expect(r.granted).toBe(maxXpFor('post'));
    expect(stored(m.store).jobXp).toEqual({ mage: maxXpFor('post') });
  });

  it('職ごとに別々に積まれる (転職しても元の職の XP が残る)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 20, key: 'a' }, NOW);
    await claimXp(env, DID, { kind: 'post', archetype: 'mage', xp: 30, key: 'b' }, NOW);
    await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 5, key: 'c' }, NOW);
    expect(stored(m.store).jobXp).toEqual({ warrior: 25, mage: 30 });
  });

  it('冪等キーは直近 MAX_CLAIM_KEYS 件までのリング', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    for (let i = 0; i < MAX_CLAIM_KEYS + 5; i++) {
      await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 1, key: `k${i}` }, NOW);
    }
    const st = stored(m.store);
    expect(st.xpClaims!.length).toBe(MAX_CLAIM_KEYS);
    expect(st.xpClaims!.at(-1)).toBe(`post:k${MAX_CLAIM_KEYS + 4}`); // 新しいものが残る
    expect(st.xpClaims!.includes('post:k0')).toBe(false); // 古いものは落ちる
  });

  it('不正な入力は 400 (負の XP / 空の職 / 長すぎるキー)', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds().fn;
    const bad = (o: Parameters<typeof claimXp>[2]) => claimXp(env, DID, o, NOW);
    await expect(bad({ kind: 'post', archetype: 'warrior', xp: -1, key: 'k' })).rejects.toBeInstanceOf(XpClaimError);
    await expect(bad({ kind: 'post', archetype: '', xp: 1, key: 'k' })).rejects.toBeInstanceOf(XpClaimError);
    await expect(bad({ kind: 'post', archetype: 'warrior', xp: 1, key: 'x'.repeat(300) })).rejects.toBeInstanceOf(XpClaimError);
    await expect(bad({ kind: 'post', archetype: 'warrior', xp: Number.NaN, key: 'k' })).rejects.toBeInstanceOf(XpClaimError);
  });
});
