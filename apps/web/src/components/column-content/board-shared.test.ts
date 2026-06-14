import { describe, it, expect } from 'vitest';
import { pendingApprovalQuests } from './board-shared';
import type { UserQuest } from '@aozoraquest/core';

function q(over: Partial<UserQuest>): UserQuest {
  return {
    uri: over.uri ?? 'at://did:plc:me/app.aozoraquest.userQuest/x',
    did: 'did:plc:me',
    title: 't',
    body: '',
    tags: [],
    visibility: 'public',
    status: 'open',
    rewardPoints: 0,
    createdAt: '2026-06-15T00:00:00Z',
    updatedAt: '2026-06-15T00:00:00Z',
    ...over,
  };
}

describe('pendingApprovalQuests', () => {
  it('status=reported の自分の依頼だけを承認待ちとして返す', () => {
    const mine = [
      q({ uri: 'at://x/1', status: 'open' }),
      q({ uri: 'at://x/2', status: 'reported' }),
      q({ uri: 'at://x/3', status: 'assigned' }),
      q({ uri: 'at://x/4', status: 'reported' }),
      q({ uri: 'at://x/5', status: 'completed' }),
    ];
    const pending = pendingApprovalQuests(mine);
    expect(pending.map((p) => p.uri)).toEqual(['at://x/2', 'at://x/4']);
  });

  it('null / 空配列は空を返す', () => {
    expect(pendingApprovalQuests(null)).toEqual([]);
    expect(pendingApprovalQuests([])).toEqual([]);
  });
});
