/**
 * web (`loadAuthoredWorld`) と edge (`ensureAuthoredWorld`) は同じ core の loadAdminWorld を通り、
 * 同じレコードから同じ順序で読み、同じ結果になる (Refs #718)。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@atproto/api';
import { ADMIN_WORLD_RECORDS, allNpcs, gameQuests, setGameQuests, setNpcs, setShopOverrides, shopOverrides, type NpcDef } from '@aozoraquest/core';
import { loadAuthoredWorld } from './world-authoring';

/** edge の実装をそのまま読む。web の tsc (rootDir=src) に edge を含めないよう、型は手書きで動的 import。 */
const EDGE_WORLD_AUTHORING = '../../../edge/src/world-authoring';
type EdgeWorldAuthoring = {
  ensureAuthoredWorld: (env: { ADMIN_DIDS?: string }, now: number) => Promise<void>;
  resetAuthoredWorldCache: () => void;
};

const DID = 'did:plc:admin';
const NPC: NpcDef = { id: 'elder', name: '長老', x: 3, y: 4, lines: ['やあ'] };
const RECORDS: Record<string, unknown> = { npcs: { npcs: [NPC] }, shops: { shops: [] }, quests: { quests: [] } };
const nameOf = (collection: string) => collection.slice(collection.lastIndexOf('.') + 1);

async function viaWeb(): Promise<string[]> {
  const read: string[] = [];
  const getRecord = async ({ collection }: { collection: string }) => {
    read.push(nameOf(collection));
    const value = RECORDS[nameOf(collection)];
    if (value) return { data: { value } };
    throw Object.assign(new Error('Could not locate record'), { name: 'RecordNotFoundError' });
  };
  vi.stubEnv('VITE_ADMIN_DIDS', DID);
  await loadAuthoredWorld({ com: { atproto: { repo: { getRecord } } } } as unknown as Agent);
  return read;
}

async function viaEdge(): Promise<string[]> {
  const read: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('plc.directory')) return Response.json({ id: DID, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://pds.test' }] });
    const name = nameOf(new URL(url).searchParams.get('collection') ?? '');
    read.push(name);
    const value = RECORDS[name];
    return value ? Response.json({ uri: 'x', cid: 'c', value }) : Response.json({ error: 'RecordNotFound' }, { status: 400 });
  }));
  const { ensureAuthoredWorld, resetAuthoredWorldCache } = await import(/* @vite-ignore */ EDGE_WORLD_AUTHORING) as EdgeWorldAuthoring;
  resetAuthoredWorldCache();
  await ensureAuthoredWorld({ ADMIN_DIDS: DID }, 1_700_000_000);
  return read;
}

function snapshot() {
  return { npcs: allNpcs().map((n) => n.id), shops: shopOverrides(), quests: gameQuests().map((q) => q.id) };
}

describe('web と edge の管理ワールド読み込みは同じ (Refs #718)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); setNpcs(null); setShopOverrides(null); setGameQuests(null); });

  it('同じ順序で読み、同じ状態になる', async () => {
    setShopOverrides([{ x: 10, y: 20, consumables: [] }]);
    const webRead = await viaWeb();
    const web = snapshot();
    setNpcs(null); setShopOverrides([{ x: 10, y: 20, consumables: [] }]); setGameQuests(null);
    const edgeRead = await viaEdge();
    expect(webRead).toEqual([...ADMIN_WORLD_RECORDS]);
    expect(edgeRead).toEqual(webRead);
    expect(snapshot()).toEqual(web);
    expect(web).toEqual({ npcs: ['elder'], shops: [], quests: [] });
  });
});
