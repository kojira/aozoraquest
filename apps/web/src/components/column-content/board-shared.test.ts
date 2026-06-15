import { describe, it, expect } from 'vitest';
import { filterForBoard } from './board-shared';
import type { QuestIndex, QuestIndexSummary } from '@/lib/quest-api';

function s(over: Partial<QuestIndexSummary>): QuestIndexSummary {
  return {
    uri: over.uri ?? 'at://x/1',
    did: over.did ?? 'did:plc:owner',
    title: 't',
    tags: [],
    rewardPoints: 0,
    status: over.status ?? 'open',
    createdAt: '2026-06-15T00:00:00Z',
    ...over,
  };
}

function idx(quests: QuestIndexSummary[]): QuestIndex {
  return { quests, applications: [], updatedAt: '2026-06-15T00:00:00Z' };
}

describe('filterForBoard: assigned (受託中)', () => {
  const me = 'did:plc:me';
  const index = idx([
    s({ uri: 'at://x/1', status: 'open' }),
    s({ uri: 'at://x/2', status: 'assigned', assignee: me }),       // 自分が受託中 → 出る
    s({ uri: 'at://x/3', status: 'assigned', assignee: 'did:plc:other' }), // 他人が受託 → 除外
    s({ uri: 'at://x/4', status: 'completed', assignee: me }),       // 完了 → 受託中からは抜ける
  ]);

  it('自分が受託確定済みかつ未完了のクエストだけを返す', () => {
    const r = filterForBoard({ kind: 'assigned' }, index, null, null, me);
    expect(r?.map(q => q.uri)).toEqual(['at://x/2']);
  });

  it('未ログイン (selfDid=null) は空', () => {
    expect(filterForBoard({ kind: 'assigned' }, index, null, null, null)).toEqual([]);
  });

  it('index 未ロードは null (読み込み中)', () => {
    expect(filterForBoard({ kind: 'assigned' }, null, null, null, me)).toBeNull();
  });
});
