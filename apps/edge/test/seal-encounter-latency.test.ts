import { describe, it, expect, afterEach } from 'vitest';
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { sealEncounter, type ResolverEnv } from '../src/battle-resolver';
import { writeServerTokens } from '../src/oauth-store';
import { XP_EPOCH, type GameState } from '../src/game-state';

// 遭遇成立 (sealEncounter) の外部往復が直列に並ぶと、遭遇する一歩だけ client の次の歩行が止まる。
// 互いに依存しない読み (診断 / kuda / 既存ガード) は同時に始まることを、開始時刻で確かめる。
const USER = 'did:plc:latency';
const SERVER_DID = 'did:plc:testserver';
const NOW = 1_700_000_000;
const DELAY_MS = 40;

function jwkJson(fill: number): string {
  const d = new Uint8Array(32).fill(fill);
  const pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33, 65)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
async function makeEnv(): Promise<ResolverEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: SERVER_DID, accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://server-pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwkJson(3), OAUTH_DPOP_PRIVATE_JWK: jwkJson(5), SERVER_DID, WORKER_DID: 'did:web:edge.aozoraquest.app', OAUTH_TOKENS: kv, KUDA_API_KEY: 'kuda_test' };
}
const GS: GameState = { did: USER, activeQuests: [], power: 5, playerXp: 100, jobXp: { warrior: 50 }, materials: {}, gear: [], x: 0, y: 0, xpEpoch: XP_EPOCH, version: 1, updatedAt: '' };

type Call = { label: string; start: number; end: number; body?: { swapRecord?: string | null } };
/** 全外部呼び出しを DELAY_MS 遅らせ、開始/終了時刻を記録する fetch。orphanGuard で孤立ガードを置く。 */
function timedFetch(orphanGuard: boolean) {
  const calls: Call[] = [];
  const t0 = performance.now();
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const fn = (async (url: string, init: RequestInit = {}) => {
    const col = url.includes('getRecord') ? new URL(url).searchParams.get('collection') : null;
    const label = url.includes('plc.directory') ? 'did' : url.includes('kuda') ? 'kuda' : col?.endsWith('.analysis') ? 'diagnosis'
      : col?.endsWith('battleGuard') ? 'readGuard' : url.includes('deleteRecord') ? 'deleteGuard' : url.includes('putRecord') ? 'putGuard' : url;
    const call: Call = { label, start: performance.now() - t0, end: -1, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    call.end = performance.now() - t0;
    if (label === 'did') return json({ id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
    if (label === 'kuda') return json({ value: 7, drop_seq: 1, pool_seq: 1, batch: 'b', drawn_at: '', pool_remaining: 9 });
    if (label === 'diagnosis') return json({ uri: 'x', cid: 'd', value: { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } } });
    if (label === 'readGuard') return orphanGuard ? json({ uri: 'x', cid: 'orphan', value: { did: USER, battleId: 'old' } }) : json({ error: 'RecordNotFound' }, 400);
    return json({ uri: 'x', cid: 'new' });
  }) as unknown as typeof fetch;
  return { fn, calls, get: (l: string) => calls.filter((c) => c.label === l) };
}

describe('sealEncounter の外部往復 (遭遇の一歩の待ち時間)', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('診断・kuda・既存ガードの読みは、どれかが返る前に全部始まる', async () => {
    const t = timedFetch(false);
    globalThis.fetch = t.fn;
    await sealEncounter(await makeEnv(), USER, GS, 5, 5, 12345, NOW);
    const [diag] = t.get('diagnosis'), [kuda] = t.get('kuda'), [guard] = t.get('readGuard');
    const firstEnd = Math.min(...t.calls.filter((c) => c.label !== 'putGuard').map((c) => c.end));
    expect(kuda!.start).toBeLessThan(firstEnd);
    expect(guard!.start).toBeLessThan(firstEnd);
    expect(diag!.start).toBeLessThan(t.get('did')[0]!.end + DELAY_MS);
    // ガード作成は「既存ガード無し」を確かめてから (CAS: 未存在のときだけ作成)。
    const [put] = t.get('putGuard');
    expect(put!.start).toBeGreaterThanOrEqual(guard!.end);
    expect(put!.body?.swapRecord).toBeNull();
  });

  it('孤立ガードは削除と作成の 2 往復ではなく、その CID を期待する 1 回の置き換えで済ませる', async () => {
    const t = timedFetch(true);
    globalThis.fetch = t.fn;
    await sealEncounter(await makeEnv(), USER, GS, 5, 5, 12345, NOW);
    expect(t.get('deleteGuard')).toHaveLength(0);
    const puts = t.get('putGuard');
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body?.swapRecord).toBe('orphan');
  });
});
