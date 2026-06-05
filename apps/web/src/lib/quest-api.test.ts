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
