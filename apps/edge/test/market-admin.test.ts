/**
 * D-MARKET-001 PR5: 管理者の非表示 `POST /api/admin/market/hide` (ADMIN_DIDS だけ)。
 * 外した品は消さない — 出品者が次に店を開いたときの照合で持ち物に戻る。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { initSecp256k1 } from '../src/secp256k1-wasm';
import { LXM } from '@aozoraquest/core';
import { handleRequest } from '../src/router';
import { marketList, marketReconcile } from '../src/market';
import { DID, GS, makeEnv, seedGs, serverPds, serviceJwt, TOWN } from './support/market-env';

beforeAll(() => {
  initSecp256k1(readFileSync(new URL('../src/vendor/secp256k1-verify/secp256k1_verify_bg.wasm', import.meta.url)));
});

const ADMIN = 'did:plc:admin';
const hide = (iss: string, body: unknown) => new Request('https://edge.test/api/admin/market/hide', {
  method: 'POST', headers: { authorization: `Bearer ${serviceJwt(iss, LXM.marketAdminHide)}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('D-MARKET-001 管理者の非表示', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  async function listed() {
    const env = { ...(await makeEnv('dev', Math.floor(Date.now() / 1000) + 3600)), ADMIN_DIDS: ADMIN };
    const pds = serverPds(seedGs(GS()));
    globalThis.fetch = pds.fn;
    await marketList(env, DID, { pieceRkey: 'p1', price: 9, rkey: 'H1' }, Math.floor(Date.now() / 1000));
    return { env, pds };
  }

  it('ADMIN_DIDS に無い人は 403 で、棚はそのまま', async () => {
    const { env, pds } = await listed();
    const res = await handleRequest(hide(DID, { town: { x: TOWN.x, y: TOWN.y }, seller: DID, listingId: 'H1' }), env);
    expect(res.status).toBe(403);
    expect(pds.shelf()!.listings.map((l) => l.id)).toEqual(['H1']);
  });

  it('管理者が外した品は棚から消え、出品者の照合で持ち物に戻る (品は消さない)', async () => {
    const { env, pds } = await listed();
    const res = await handleRequest(hide(ADMIN, { town: { x: TOWN.x, y: TOWN.y }, seller: DID, listingId: 'H1' }), env);
    expect(res.status).toBe(200);
    expect(pds.shelf()!.listings).toEqual([]);
    expect(pds.gs().pieces!.map((p) => p.rkey)).toEqual(['p2', 'p3']);
    const r = await marketReconcile(env, DID, Math.floor(Date.now() / 1000) + 1);
    expect(r.returned.map((l) => l.id)).toEqual(['H1']);
    expect(pds.gs().pieces!.map((p) => p.rkey).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(pds.gs().listings).toEqual([]);
  });

  it('棚に無い品は 404', async () => {
    const { env } = await listed();
    const res = await handleRequest(hide(ADMIN, { town: { x: TOWN.x, y: TOWN.y }, seller: DID, listingId: 'nope' }), env);
    expect(res.status).toBe(404);
  });
});
