import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { parseAtUri, questUrlOf } from './quest-api';
import { mockIndex } from './quest-mock';
import type { UserQuest } from '@aozoraquest/core';

// in-memory localStorage polyfill (node 環境では存在しないので)
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    };
  }
});

describe('parseAtUri', () => {
  it('parses a valid at-uri', () => {
    const r = parseAtUri('at://did:plc:abc123/app.aozoraquest.userQuest/3lp7z9');
    expect(r).toEqual({
      repo: 'did:plc:abc123',
      collection: 'app.aozoraquest.userQuest',
      rkey: '3lp7z9',
    });
  });

  it('throws for invalid uri', () => {
    expect(() => parseAtUri('http://example.com/foo')).toThrow(/invalid at-uri/);
    expect(() => parseAtUri('at://only-did')).toThrow(/invalid at-uri/);
  });

  it('preserves nested rkey containing dots', () => {
    const r = parseAtUri('at://did:plc:x/app.example.col/some.rkey');
    expect(r.rkey).toBe('some.rkey');
  });
});

describe('questUrlOf', () => {
  it('encodes at-uri into /quests/<encoded>', () => {
    const url = questUrlOf('at://did:plc:abc/app.aozoraquest.userQuest/r1', 'https://aozoraquest.app');
    expect(url).toBe('https://aozoraquest.app/quests/at%3A%2F%2Fdid%3Aplc%3Aabc%2Fapp.aozoraquest.userQuest%2Fr1');
  });
});

describe('mockIndex', () => {
  beforeEach(() => mockIndex.clear());

  function mk(over: Partial<UserQuest>): UserQuest {
    return {
      uri: 'at://did:plc:a/app.aozoraquest.userQuest/x',
      did: 'did:plc:a',
      title: 't',
      body: 'b',
      tags: [],
      visibility: 'public',
      status: 'open',
      rewardPoints: 100,
      createdAt: '2026-06-05T00:00:00Z',
      updatedAt: '2026-06-05T00:00:00Z',
      ...over,
    };
  }

  it('initially empty', () => {
    expect(mockIndex().quests).toEqual([]);
    expect(mockIndex().applications).toEqual([]);
  });

  it('addQuest stores summary', () => {
    mockIndex.addQuest(mk({ title: 'hello', rewardPoints: 12000 }));
    const idx = mockIndex();
    expect(idx.quests).toHaveLength(1);
    expect(idx.quests[0]!).toMatchObject({ title: 'hello', rewardPoints: 12000 });
  });

  it('addQuest overwrites same uri', () => {
    mockIndex.addQuest(mk({ uri: 'u1', title: 'v1' }));
    mockIndex.addQuest(mk({ uri: 'u1', title: 'v2' }));
    expect(mockIndex().quests).toHaveLength(1);
    expect(mockIndex().quests[0]!.title).toBe('v2');
  });

  it('updateQuestStatus changes status of existing summary', () => {
    mockIndex.addQuest(mk({ uri: 'u1', status: 'open' }));
    mockIndex.updateQuestStatus('u1', 'completed');
    expect(mockIndex().quests[0]!.status).toBe('completed');
  });

  it('addApplication stores app entry', () => {
    mockIndex.addApplication({
      uri: 'app1',
      did: 'did:plc:applicant',
      questUri: 'u1',
      createdAt: '2026-06-05T00:00:00Z',
    });
    expect(mockIndex().applications).toHaveLength(1);
    expect(mockIndex().applications[0]!.questUri).toBe('u1');
  });

  it('addApplication ignores duplicate uri', () => {
    const a = { uri: 'app1', did: 'did:plc:x', questUri: 'u1', createdAt: 't' };
    mockIndex.addApplication(a);
    mockIndex.addApplication(a);
    expect(mockIndex().applications).toHaveLength(1);
  });
});

describe('buildQuestIndexFromDirectory', () => {
  // listRecords をコレクション種別で出し分ける fake agent を作る
  function fakeAgent(byDid: Record<string, { quests?: any[]; apps?: any[] }>) {
    return {
      com: {
        atproto: {
          repo: {
            listRecords: async ({ repo, collection }: { repo: string; collection: string }) => {
              const data = byDid[repo] ?? {};
              const isQuest = collection.endsWith('userQuest');
              const recs = (isQuest ? data.quests : data.apps) ?? [];
              return { data: { records: recs } };
            },
          },
        },
      },
    } as any;
  }

  it('集約: 複数 DID の quest を summary 化してまとめる', async () => {
    const { buildQuestIndexFromDirectory } = await import('./quest-api');
    const agent = fakeAgent({
      'did:plc:a': {
        quests: [{
          uri: 'at://did:plc:a/c/1',
          value: { title: 'A の依頼', tags: ['x'], rewardPoints: 100, status: 'open', createdAt: '2026-06-01T00:00:00Z' },
        }],
      },
      'did:plc:b': {
        quests: [{
          uri: 'at://did:plc:b/c/2',
          value: { title: 'B の依頼', tags: [], rewardPoints: 50, status: 'open', createdAt: '2026-06-02T00:00:00Z' },
        }],
        apps: [{ uri: 'at://did:plc:b/ca/1', value: { questUri: 'at://did:plc:a/c/1', createdAt: '2026-06-03T00:00:00Z' } }],
      },
    });
    const idx = await buildQuestIndexFromDirectory(agent, ['did:plc:a', 'did:plc:b']);
    expect(idx.quests).toHaveLength(2);
    // createdAt 降順
    expect(idx.quests[0]!.uri).toBe('at://did:plc:b/c/2');
    expect(idx.quests[0]!.did).toBe('did:plc:b');
    expect(idx.applications).toHaveLength(1);
    expect(idx.applications[0]!.questUri).toBe('at://did:plc:a/c/1');
  });

  it('重複 DID を 1 回だけ読む (dedup)', async () => {
    const { buildQuestIndexFromDirectory } = await import('./quest-api');
    const agent = fakeAgent({
      'did:plc:a': { quests: [{ uri: 'at://did:plc:a/c/1', value: { title: 't', tags: [], rewardPoints: 0, status: 'open', createdAt: '2026-06-01T00:00:00Z' } }] },
    });
    const idx = await buildQuestIndexFromDirectory(agent, ['did:plc:a', 'did:plc:a']);
    expect(idx.quests).toHaveLength(1);
  });

  it('一部 DID の読み取り失敗を無視して続行する', async () => {
    const { buildQuestIndexFromDirectory } = await import('./quest-api');
    const agent = {
      com: { atproto: { repo: { listRecords: async ({ repo }: { repo: string }) => {
        if (repo === 'did:plc:bad') throw new Error('boom');
        return { data: { records: [{ uri: 'at://did:plc:ok/c/1', value: { title: 'ok', tags: [], rewardPoints: 0, status: 'open', createdAt: 't' } }] } };
      } } } },
    } as any;
    const idx = await buildQuestIndexFromDirectory(agent, ['did:plc:bad', 'did:plc:ok']);
    // bad は失敗、ok の quest だけ残る (userQuest/questApplication 両方 ok を返すが questUri 無し app は除外)
    expect(idx.quests.some((q) => q.did === 'did:plc:ok')).toBe(true);
  });
});
