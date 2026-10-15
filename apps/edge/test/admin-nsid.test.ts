/**
 * 管理データの保存先の env 分離 (#716)。dev エッジ ([env.dev.vars] ADMIN_NSID_ENV="dev") は
 * `app.aozoraquest.dev.*`、本番エッジ (未設定) は従来どおり `app.aozoraquest.*` を読み書きする。
 * dev のレコードが無ければ同梱の既定に倒れる (本番へは読みに行かない)。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_CONFIG_RECORDS, ADMIN_WORLD_RECORDS, adminNsidPrefix, adminWorldCollection, allNpcs, AQ_NSID_ROOT, setNpcs } from '@aozoraquest/core';
import { adminNsidRoot, ensureAuthoredWorld, resetAuthoredWorldCache } from '../src/world-authoring';
import { handleNpcImage } from '../src/npc-image';
import { ADMIN_DATA_NAMES } from '../src/admin-data';
import { png, cidFor } from '../../../packages/core/src/__tests__/helpers/npc-images';

vi.mock('../src/service-auth', async (original) => ({ ...await original<typeof import('../src/service-auth')>(), resolveDidDocument: async (did: string) => (await fetch(`https://plc.directory/${did}`)).json() }));

describe('adminNsidRoot (#716)', () => {
  it('dev は app.aozoraquest.dev、未設定 (本番) は app.aozoraquest', () => {
    expect(adminNsidRoot({ ADMIN_NSID_ENV: 'dev' })).toBe('app.aozoraquest.dev');
    expect(adminNsidRoot({})).toBe('app.aozoraquest');
    expect(adminNsidRoot({ ADMIN_NSID_ENV: ' ' })).toBe('app.aozoraquest');
  });

  it('wrangler: dev エッジだけ ADMIN_NSID_ENV="dev"、本番 (top-level) には置かない', () => {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    const devVars = toml.slice(toml.indexOf('[env.dev.vars]'));
    expect(devVars).toMatch(/^ADMIN_NSID_ENV = "dev"$/m);
    expect(toml.slice(0, toml.indexOf('[env.dev]'))).not.toMatch(/ADMIN_NSID_ENV/);
  });
});

describe('GET /api/npc-image は env の管理コレクションを読む (#716)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const did = 'did:plc:npcimageauthor';
  const bytes = png();
  const cid = cidFor(bytes);
  async function serve(env: { ADMIN_DIDS: string; ADMIN_NSID_ENV?: string }) {
    const collections: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('plc.directory')) return Response.json({ id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://npc-author.example' }] });
      if (url.includes('getRecord')) {
        collections.push(new URL(url).searchParams.get('collection') ?? '');
        return Response.json({ value: { npcs: [{ id: 'npc-one', spriteImage: { width: 32, height: 32, blob: { $type: 'blob', ref: { $link: cid }, mimeType: 'image/png', size: bytes.length } } }] } });
      }
      if (url.includes('getBlob')) return new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': 'image/png' } });
      throw new Error('unexpected URL');
    }));
    const res = await handleNpcImage(new Request(`https://edge.example/api/npc-image?${new URLSearchParams({ npcId: 'npc-one', kind: 'sprite', cid })}`), env);
    return { status: res.status, collections };
  }

  it('dev エッジは app.aozoraquest.dev.world.npcs を読み、同じ repo の blob を返す', async () => {
    expect(await serve({ ADMIN_DIDS: did, ADMIN_NSID_ENV: 'dev' })).toEqual({ status: 200, collections: ['app.aozoraquest.dev.world.npcs'] });
  });

  it('本番エッジは従来どおり app.aozoraquest.world.npcs', async () => {
    expect(await serve({ ADMIN_DIDS: did })).toEqual({ status: 200, collections: ['app.aozoraquest.world.npcs'] });
  });
});

describe('ensureAuthoredWorld は env の管理コレクションだけを読む (#716)', () => {
  afterEach(() => { vi.unstubAllGlobals(); resetAuthoredWorldCache(); setNpcs(null); });
  const did = 'did:plc:admin';
  /** 本番側にだけ NPC がある PDS。読んだ collection を記録する。 */
  function prodOnlyPds() {
    const read: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('plc.directory')) return Response.json({ id: did, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }] });
      const col = new URL(url).searchParams.get('collection') ?? '';
      read.push(col);
      if (col === 'app.aozoraquest.world.npcs') return Response.json({ uri: 'x', cid: 'c', value: { npcs: [{ id: 'prod', name: '本番', x: 1, y: 1, lines: ['x'] }] } });
      return Response.json({ error: 'RecordNotFound' }, { status: 400 });
    }));
    return read;
  }

  it('dev は app.aozoraquest.dev.world.* だけを読み、dev に無ければ本番へ取りに行かず既定のまま', async () => {
    resetAuthoredWorldCache(); setNpcs(null);
    const before = allNpcs();
    const read = prodOnlyPds();
    await ensureAuthoredWorld({ ADMIN_DIDS: did, ADMIN_NSID_ENV: 'dev' }, 1_700_000_000);
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((c) => c.startsWith('app.aozoraquest.dev.world.'))).toBe(true);
    expect(allNpcs()).toEqual(before);
  });

  it('本番は従来どおり app.aozoraquest.world.* を読む', async () => {
    resetAuthoredWorldCache();
    const read = prodOnlyPds();
    await ensureAuthoredWorld({ ADMIN_DIDS: did }, 1_700_000_000);
    expect(read.every((c) => c.startsWith('app.aozoraquest.world.'))).toBe(true);
    expect(allNpcs().map((n) => n.id)).toEqual(['prod']);
  });
});

describe('scripts/*.mjs の NSID は core の唯一の定義と一致する (Refs #718)', () => {
  it('admin-data.mjs の DEV_COLLECTION_PREFIX = core の dev world prefix', async () => {
    // @ts-expect-error -- 型定義の無い Node スクリプト
    const { DEV_COLLECTION_PREFIX } = await import('../../../scripts/admin-data.mjs');
    expect(DEV_COLLECTION_PREFIX).toBe(`${adminWorldCollection(adminNsidPrefix(AQ_NSID_ROOT, 'dev'), 'npcs').slice(0, -'npcs'.length)}`);
  });

  it('admin-data.mjs の NAMES = edge の ADMIN_DATA_NAMES (core の world.* に含まれる。items を含む)', async () => {
    // @ts-expect-error -- 型定義の無い Node スクリプト
    const { NAMES } = await import('../../../scripts/admin-data.mjs');
    expect(NAMES).toEqual([...ADMIN_DATA_NAMES]);
    expect(NAMES).toContain('items');
    expect(NAMES).toContain('monsterArt'); // D-MONSTER-001 PR2
    for (const n of NAMES) expect(ADMIN_WORLD_RECORDS).toContain(n);
  });

  it('copy-admin-data-to-dev.mjs の SOURCE_COLLECTIONS = core の本番 world.* + config.*', async () => {
    // @ts-expect-error -- 型定義の無い Node スクリプト
    const { SOURCE_COLLECTIONS, devCollectionOf } = await import('../../../scripts/copy-admin-data-to-dev.mjs');
    const prod = adminNsidPrefix(AQ_NSID_ROOT, undefined);
    expect(SOURCE_COLLECTIONS).toContain('app.aozoraquest.world.monsterArt'); // D-MONSTER-001 PR2
    const expected = [...ADMIN_WORLD_RECORDS.map((n) => adminWorldCollection(prod, n)), ...ADMIN_CONFIG_RECORDS.map((n) => `${prod}.config.${n}`)];
    expect([...SOURCE_COLLECTIONS].sort()).toEqual(expected.sort());
    for (const n of ADMIN_WORLD_RECORDS) expect(devCollectionOf(adminWorldCollection(prod, n))).toBe(adminWorldCollection(adminNsidPrefix(AQ_NSID_ROOT, 'dev'), n));
  });
});
