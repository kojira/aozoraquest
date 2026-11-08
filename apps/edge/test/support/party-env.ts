/** パーティの edge テストの共通部 (party.test.ts・gacha.test.ts)。PDS は fetch の差し替えで、本物の鍵・KV は読まない。 */
import { p256 } from '@noble/curves/p256';
import { base64urlnopad } from '@scure/base';
import { BASE_PALETTE, type InteriorMap, type NpcDef } from '@aozoraquest/core';
import type { ResolverEnv } from '../../src/battle-resolver';
import { writeServerTokens } from '../../src/oauth-store';
import { signPosition } from '../../src/world-token';
import { XP_EPOCH, type GameState } from '../../src/game-state';

export const USER = 'did:plc:alice';
export const NOW = 1_700_000_000;
function jwk(fill: number) {
  const d = new Uint8Array(32).fill(fill), pub = p256.getPublicKey(d, false);
  return JSON.stringify({ kty: 'EC', crv: 'P-256', x: base64urlnopad.encode(pub.slice(1, 33)), y: base64urlnopad.encode(pub.slice(33)), d: base64urlnopad.encode(d), kid: `k${fill}` });
}
export async function makeEnv(): Promise<ResolverEnv> {
  const m = new Map<string, string>();
  const kv = { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as unknown as KVNamespace;
  await writeServerTokens(kv, { did: 'did:plc:server', accessToken: 'AT', refreshToken: 'RT', tokenType: 'DPoP', expiresAt: NOW + 3600, pdsUrl: 'https://server-pds.example', authServer: 'https://bsky.social', updatedAt: NOW });
  return { OAUTH_CLIENT_PRIVATE_JWK: jwk(3), OAUTH_DPOP_PRIVATE_JWK: jwk(5), SERVER_DID: 'did:plc:server', WORKER_DID: 'did:web:edge.example', OAUTH_TOKENS: kv };
}
export const LETTER = 'futaba_letter_done';
export const GS = (over: Partial<GameState> = {}): GameState => ({ did: USER, activeQuests: [], power: 9, playerXp: 100, jobXp: { warrior: 400 }, materials: {}, gear: [], x: 10, y: 10, xpEpoch: XP_EPOCH, version: 1, updatedAt: '', ...over });

export function pds(seed: GameState) {
  const store = new Map<string, { value: unknown; cid: string }>([['gs', { value: seed, cid: 'gs0' }]]);
  let n = 0;
  const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  const key = (col: string) => (col.endsWith('.gameState') ? 'gs' : col.endsWith('.battleGuard') ? 'guard' : col);
  const fn = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('plc.directory')) return json(200, { id: USER, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://user-pds.example' }] });
    if (url.includes('getRecord')) {
      const col = new URL(url).searchParams.get('collection')!;
      if (col.endsWith('.analysis')) return json(200, { uri: 'x', cid: 'd', value: { archetype: 'warrior', rpgStats: { atk: 30, def: 25, agi: 15, int: 15, luk: 15 } } });
      const rec = store.get(key(col));
      return rec ? json(200, { uri: 'x', cid: rec.cid, value: rec.value }) : json(400, { error: 'RecordNotFound' });
    }
    const b = JSON.parse(init.body as string) as { collection: string; record?: unknown; swapRecord?: string | null };
    const k = key(b.collection), cur = store.get(k);
    if (b.swapRecord === null && cur) return json(400, { error: 'InvalidSwap' });
    if (typeof b.swapRecord === 'string' && (!cur || cur.cid !== b.swapRecord)) return json(400, { error: 'InvalidSwap' });
    if (url.includes('deleteRecord')) { store.delete(k); return json(200, {}); }
    store.set(k, { value: b.record, cid: `c${++n}` });
    return json(200, { uri: 'x', cid: `c${n}` });
  }) as unknown as typeof fetch;
  return { fn, gs: () => store.get('gs')!.value as GameState, guard: () => store.get('guard')?.value as { state: { allies?: unknown[]; enemies?: Array<{ hp: number; maxHp: number }>; monster: { maxHp: number } } } | undefined };
}


const F = BASE_PALETTE.indexOf('plains');
export const guildRoom = (): InteriorMap => ({ id: 'g-town', name: 'まち', size: 8, tiles: new Uint8Array(64).fill(F) });
export const RECEPTION: NpcDef = { id: 'g-bluesky', name: 'うけつけ', mapId: 'g-town', x: 4, y: 4, lines: ['ようこそ'], guildReception: true };
export const near = (env: ResolverEnv, iat = NOW) => signPosition(env, { did: USER, mapId: 'g-town', x: 4, y: 5, counter: 1, iat });
export const far = (env: ResolverEnv) => signPosition(env, { did: USER, mapId: 'g-town', x: 1, y: 1, counter: 1, iat: NOW });

