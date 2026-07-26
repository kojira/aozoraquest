import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { XP_REWARDS, MAX_DAILY_QUEST_XP, DEFAULT_QUEST_TEMPLATES, JOB_LEVEL_TUNING, jobLevelFromXp } from '@aozoraquest/core';
import { claimXp, adminSetJobXp, maxXpFor, MAX_CLAIM_KEYS, XpClaimError } from '../src/xp-claim';
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

describe('XP 申告の上限 (maxXpFor)', () => {
  it('投稿は「分類成功 + 日次ボーナス + streak 上限 + デイリークエスト」まで', () => {
    expect(maxXpFor('post')).toBe(XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap + MAX_DAILY_QUEST_XP);
  });

  it('デイリークエストを 1 件でも完了した投稿がクランプされない', () => {
    // post-processor は 1 回の申告にクエスト完了 XP を含める。上限にこれを入れ忘れると
    // 「クエストを達成した日の XP が毎日消える」という正常系のデータ欠損になる。
    const heaviest = Math.max(...DEFAULT_QUEST_TEMPLATES.map((t) => t.xpRewardFn(t.requiredCountFn(JOB_LEVEL_TUNING.maxLevel))));
    const realistic = XP_REWARDS.postMatch + XP_REWARDS.dailyBonus + XP_REWARDS.streakBonusCap + heaviest;
    expect(maxXpFor('post')).toBeGreaterThanOrEqual(realistic);
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

describe('normalizeState (ベータの区切り)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('区切り前の state は jobXp をリセットして epoch を刻む', () => {
    const v1 = { did: DID, power: 5, playerXp: 100, jobXp: { warrior: 9999 }, materials: { herb: 2 }, gear: [], x: 1, y: 2, version: 1, updatedAt: '' } as GameState;
    const out = normalizeState(v1);
    expect(out.jobXp).toEqual({});
    expect(out.xpEpoch).toBe(XP_EPOCH);
    // 持ち物・パワーは触らない (「全部消えた」にしない)
    expect(out.power).toBe(5);
    expect(out.playerXp).toBe(100);
    expect(out.materials).toEqual({ herb: 2 });
  });

  it('区切りでは位置も spawn に戻す (Lv1 で奥地に取り残さない)', async () => {
    const { worldOverlay } = await import('@aozoraquest/core');
    const spawn = worldOverlay().spawn;
    const v1 = { did: DID, power: 0, playerXp: 0, jobXp: { warrior: 9999 }, materials: {}, gear: [], x: 900, y: 900, lastTown: { x: 900, y: 900 }, carryHp: 3, version: 1, updatedAt: '' } as GameState;
    const out = normalizeState(v1);
    expect(out.x).toBe(spawn.x);
    expect(out.y).toBe(spawn.y);
    expect(out.lastTown).toEqual({ x: spawn.x, y: spawn.y });
    expect(out.carryHp).toBeUndefined(); // 全快で再開
  });

  it('区切り済みの state はそのまま (再リセットしない)', () => {
    const v2 = { did: DID, power: 5, playerXp: 0, jobXp: { warrior: 42 }, materials: {}, gear: [], x: 0, y: 0, version: 1, xpEpoch: XP_EPOCH, updatedAt: '' } as GameState;
    expect(normalizeState(v2)).toBe(v2);
  });

  it('version が旧コードに書き戻されても再リセットしない (dev↔本番の往復対策)', () => {
    // dev と本番は同じ権威レコードを共有する。version を移行マーカーにすると、
    // 本番 (旧コード) で 1 歩動くたび version が巻き戻り、次の dev アクセスで
    // jobXp がまた 0 になる。xpEpoch は旧コードが知らないので保存されて残る。
    const rolledBack = { did: DID, power: 0, playerXp: 0, jobXp: { warrior: 500 }, materials: {}, gear: [], x: 0, y: 0, version: 1, xpEpoch: XP_EPOCH, updatedAt: '' } as GameState;
    expect(normalizeState(rolledBack).jobXp).toEqual({ warrior: 500 });
  });

  it('readState が読みの時点で正規化する (書き戻し前でも古い値を使わない)', async () => {
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    m.store.set(rkeyForDid(DID), {
      cid: 'c1',
      value: { did: DID, power: 0, playerXp: 0, jobXp: { warrior: 12345 }, materials: {}, gear: [], x: 0, y: 0, version: 1, updatedAt: '' },
    });
    const got = await readState(env, DID);
    expect(got!.state.jobXp).toEqual({});
    expect(got!.state.xpEpoch).toBe(XP_EPOCH);
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
    await claimXp(env, DID, { kind: 'post', archetype: 'mage', xp: 40, key: 'k' }, NOW);
    await adminSetJobXp(env, DID, 'warrior', 10, NOW);
    expect(stored(m.store).jobXp['mage']).toBe(40);
  });

  it('範囲外のレベルは 400', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds().fn;
    await expect(adminSetJobXp(env, DID, 'warrior', 0, NOW)).rejects.toBeInstanceOf(XpClaimError);
    await expect(adminSetJobXp(env, DID, 'warrior', 999, NOW)).rejects.toBeInstanceOf(XpClaimError);
    await expect(adminSetJobXp(env, DID, '', 10, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });
});

describe('権威 state の新規作成 (init)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('init を渡せばそこから作られる (パワー・持ち物・位置が失われない)', async () => {
    // init を渡し忘れると emptyState で作られ、ユーザー PDS のパワー残高・冒険はじめの
    // 持ち物・開始位置が取り込まれないまま固定される。以後 readState が null を返さないので
    // 移行は二度と走らない = 恒久的なデータ喪失。router が必ず渡すことを型でなく契約で担保する。
    const env = await makeEnv();
    const m = statefulPds();
    globalThis.fetch = m.fn;
    const migrated = async (did: string, iso: string): Promise<GameState> => ({
      did, power: 42, playerXp: 7, jobXp: {}, materials: { herb: 1, 'sky-feather': 1 },
      gear: [], x: 211, y: 340, xpEpoch: XP_EPOCH, version: 1, updatedAt: iso,
    });
    await claimXp(env, DID, { kind: 'post', archetype: 'warrior', xp: 10, key: 'k' }, NOW, migrated);
    const st = stored(m.store);
    expect(st.power).toBe(42);
    expect(st.materials).toEqual({ herb: 1, 'sky-feather': 1 });
    expect(st.x).toBe(211);
    expect(st.jobXp).toEqual({ warrior: 10 });
  });

  it('実在しない職は 400 (権威レコードのキー空間を汚させない)', async () => {
    const env = await makeEnv();
    globalThis.fetch = statefulPds().fn;
    await expect(claimXp(env, DID, { kind: 'post', archetype: 'not-a-job', xp: 1, key: 'k' }, NOW)).rejects.toBeInstanceOf(XpClaimError);
    await expect(adminSetJobXp(env, DID, 'not-a-job', 10, NOW)).rejects.toBeInstanceOf(XpClaimError);
  });
});
