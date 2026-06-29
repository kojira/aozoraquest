import { describe, it, expect } from 'vitest';
import {
  isExpired,
  isCompleted,
  isValidCompletion,
  needsRequesterApproval,
  effectiveState,
  effectiveStateForAssignee,
  questLevelState,
  questAssignees,
  questMaxAssignees,
  hasOpenSlot,
  completionTarget,
  isCompletedForAssignee,
  rewardForMe,
  MAX_ASSIGNEES_PER_QUEST,
  questXpScalar,
  outcomeOf,
  holdings,
  totalIssued,
  shareOf,
  distinctRecipients,
  distinctRequesters,
  summarize,
  formatQuestAnnouncement,
  formatNotificationPost,
  checkIssuanceLimits,
  MAX_OPEN_QUESTS_PER_USER,
  MAX_QUESTS_PER_DAY,
  type UserQuest,
  type QuestCompletion,
} from '../user-quest.js';

const NOW = new Date('2026-06-05T00:00:00Z');

function mk(over: Partial<UserQuest>): UserQuest {
  return {
    uri: 'at://did:plc:owner/app.aozoraquest.userQuest/abc',
    did: 'did:plc:owner',
    title: 't',
    body: 'b',
    tags: [],
    visibility: 'public',
    status: 'open',
    rewardPoints: 100,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...over,
  };
}

describe('isExpired', () => {
  it('returns false when no deadline', () => {
    expect(isExpired(mk({}), NOW)).toBe(false);
  });

  it('returns true when status=open and deadline passed', () => {
    expect(isExpired(mk({ deadline: '2026-06-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('returns false when deadline in future', () => {
    expect(isExpired(mk({ deadline: '2026-06-10T00:00:00Z' }), NOW)).toBe(false);
  });

  it('returns false when status != open (already cancelled or completed)', () => {
    expect(isExpired(mk({ deadline: '2026-06-01T00:00:00Z', status: 'completed' }), NOW)).toBe(false);
    expect(isExpired(mk({ deadline: '2026-06-01T00:00:00Z', status: 'cancelled' }), NOW)).toBe(false);
  });
});

describe('isCompleted (耐故障性)', () => {
  it('returns true when status=completed', () => {
    expect(isCompleted(mk({ status: 'completed' }), [])).toBe(true);
  });

  it('returns true when an approval exists even if status not yet updated (= B 遅延)', () => {
    const q = mk({ status: 'reported' });
    const approval: QuestCompletion = {
      uri: 'at://did:plc:owner/app.aozoraquest.questCompletion/x',
      did: 'did:plc:owner',
      questUri: q.uri,
      role: 'requesterApproval',
      createdAt: '2026-06-05T00:00:00Z',
    };
    expect(isCompleted(q, [approval])).toBe(true);
  });

  it('ignores approvals for other quests', () => {
    const q = mk({ status: 'reported' });
    const otherApproval: QuestCompletion = {
      uri: 'at://did:plc:owner/app.aozoraquest.questCompletion/x',
      did: 'did:plc:owner',
      questUri: 'at://did:plc:owner/app.aozoraquest.userQuest/other',
      role: 'requesterApproval',
      createdAt: '2026-06-05T00:00:00Z',
    };
    expect(isCompleted(q, [otherApproval])).toBe(false);
  });

  it('ignores assigneeReport or requesterRevision', () => {
    const q = mk({ status: 'reported' });
    const cs: QuestCompletion[] = [
      { uri: 'r1', did: 'did:plc:as', questUri: q.uri, role: 'assigneeReport', createdAt: 'x' },
      { uri: 'r2', did: 'did:plc:owner', questUri: q.uri, role: 'requesterRevision', createdAt: 'x' },
    ];
    expect(isCompleted(q, cs)).toBe(false);
  });

  it('★ approval owner DID が quest.did と一致しないと完了と見なさない (偽造防止)', () => {
    const q = mk({ status: 'reported', did: 'did:plc:owner', uri: 'at://owner/q/1' });
    const fakeApproval: QuestCompletion = {
      uri: 'at://attacker/c/x',
      did: 'did:plc:attacker',  // ← quest.did と違う
      questUri: q.uri,
      role: 'requesterApproval',
      createdAt: 'x',
    };
    expect(isCompleted(q, [fakeApproval])).toBe(false);
  });
});

describe('needsRequesterApproval (status ではなく completion record から導出)', () => {
  const q = mk({ status: 'assigned', assignee: 'did:plc:assignee', did: 'did:plc:owner' });
  const report = (at: string): QuestCompletion =>
    ({ uri: `r-${at}`, did: 'did:plc:assignee', questUri: q.uri, role: 'assigneeReport', createdAt: at });
  const approval = (at: string): QuestCompletion =>
    ({ uri: `a-${at}`, did: 'did:plc:owner', questUri: q.uri, role: 'requesterApproval', createdAt: at });
  const revision = (at: string): QuestCompletion =>
    ({ uri: `v-${at}`, did: 'did:plc:owner', questUri: q.uri, role: 'requesterRevision', createdAt: at });

  it('受託者の完了報告が来ていて未承認なら true (status は assigned のまま)', () => {
    expect(needsRequesterApproval(q, [report('2026-06-15T01:00:00Z')])).toBe(true);
  });
  it('まだ報告が来ていなければ false', () => {
    expect(needsRequesterApproval(q, [])).toBe(false);
  });
  it('既に承認済みなら false', () => {
    expect(needsRequesterApproval(q, [report('2026-06-15T01:00:00Z'), approval('2026-06-15T02:00:00Z')])).toBe(false);
  });
  it('差し戻し後・再報告前 (差し戻しが最新) は false (受託者待ち)', () => {
    expect(needsRequesterApproval(q, [report('2026-06-15T01:00:00Z'), revision('2026-06-15T02:00:00Z')])).toBe(false);
  });
  it('差し戻し後に再報告が来たら true (承認待ちに戻る)', () => {
    expect(needsRequesterApproval(q, [report('2026-06-15T01:00:00Z'), revision('2026-06-15T02:00:00Z'), report('2026-06-15T03:00:00Z')])).toBe(true);
  });
  it('completed / cancelled は常に false', () => {
    expect(needsRequesterApproval(mk({ ...q, status: 'completed' }), [report('2026-06-15T01:00:00Z')])).toBe(false);
    expect(needsRequesterApproval(mk({ ...q, status: 'cancelled' }), [report('2026-06-15T01:00:00Z')])).toBe(false);
  });
  it('assignee 以外が書いた偽の報告は無視する', () => {
    const fake: QuestCompletion = { uri: 'r', did: 'did:plc:attacker', questUri: q.uri, role: 'assigneeReport', createdAt: '2026-06-15T01:00:00Z' };
    expect(needsRequesterApproval(q, [fake])).toBe(false);
  });
});

describe('effectiveState (唯一の真実)', () => {
  const owner = 'did:plc:owner';
  const assignee = 'did:plc:assignee';
  const report = (at: string): QuestCompletion => ({ uri: `r-${at}`, did: assignee, questUri: 'at://did:plc:owner/app.aozoraquest.userQuest/abc', role: 'assigneeReport', createdAt: at });
  const approval = (at: string): QuestCompletion => ({ uri: `a-${at}`, did: owner, questUri: 'at://did:plc:owner/app.aozoraquest.userQuest/abc', role: 'requesterApproval', createdAt: at });
  const revision = (at: string): QuestCompletion => ({ uri: `v-${at}`, did: owner, questUri: 'at://did:plc:owner/app.aozoraquest.userQuest/abc', role: 'requesterRevision', createdAt: at });

  it('cancelled / completed を最優先', () => {
    expect(effectiveState(mk({ status: 'cancelled' }), [])).toBe('CANCELLED');
    expect(effectiveState(mk({ status: 'completed' }), [])).toBe('COMPLETED');
    expect(effectiveState(mk({ status: 'assigned', assignee, did: owner }), [approval('2026-06-15T02:00:00Z')])).toBe('COMPLETED');
  });
  it('assignee 無し: open=OPEN / 期限切れ=EXPIRED', () => {
    expect(effectiveState(mk({ status: 'open' }), [], NOW)).toBe('OPEN');
    const expired = mk({ status: 'open', deadline: '2026-06-01T00:00:00Z' });
    expect(effectiveState(expired, [], NOW)).toBe('EXPIRED');
  });
  it('assignee あり: 報告前=IN_PROGRESS / 報告後=AWAITING_APPROVAL', () => {
    const q = mk({ status: 'assigned', assignee, did: owner });
    expect(effectiveState(q, [])).toBe('IN_PROGRESS');
    expect(effectiveState(q, [report('2026-06-15T01:00:00Z')])).toBe('AWAITING_APPROVAL');
  });
  it('差し戻しが最新=REVISION_REQUESTED / 再報告で AWAITING に戻る', () => {
    const q = mk({ status: 'assigned', assignee, did: owner });
    expect(effectiveState(q, [report('2026-06-15T01:00:00Z'), revision('2026-06-15T02:00:00Z')])).toBe('REVISION_REQUESTED');
    expect(effectiveState(q, [report('2026-06-15T01:00:00Z'), revision('2026-06-15T02:00:00Z'), report('2026-06-15T03:00:00Z')])).toBe('AWAITING_APPROVAL');
  });
  it('報告と差し戻しが同時刻のタイブレークは AWAITING (docs §2.3: v>r のみ REVISION)', () => {
    // 別 PDS への別 record なので現実の衝突確率はほぼ無いが、挙動を固定して回帰を防ぐ。
    const q = mk({ status: 'assigned', assignee, did: owner });
    const t = '2026-06-15T01:00:00Z';
    expect(effectiveState(q, [report(t), revision(t)])).toBe('AWAITING_APPROVAL');
  });
  it('needsRequesterApproval は effectiveState===AWAITING_APPROVAL のラッパ', () => {
    const q = mk({ status: 'assigned', assignee, did: owner });
    expect(needsRequesterApproval(q, [report('2026-06-15T01:00:00Z')])).toBe(true);
    expect(needsRequesterApproval(q, [])).toBe(false);
  });
});

describe('questXpScalar (完了集合からの派生経験値)', () => {
  const me = 'did:plc:me';
  it('自分が受託して完了したクエスト 1 件あたり固定 100 XP を合算', () => {
    const quests = [
      mk({ uri: 'at://x/1', status: 'completed', assignee: me }),                       // 採用
      mk({ uri: 'at://x/2', status: 'completed', assignee: me }),                       // 採用
      mk({ uri: 'at://x/3', status: 'assigned', assignee: me }),                        // 未完了 → 除外
      mk({ uri: 'at://x/4', status: 'completed', assignee: 'did:plc:other' }),          // 他人 → 除外
    ];
    expect(questXpScalar(quests, me)).toBe(200); // 完了 2 件 × 100
  });
  it('完了が無ければ 0', () => {
    expect(questXpScalar([mk({ status: 'open', assignee: me })], me)).toBe(0);
  });
  it('タグに依存せず一律 (内容で配分しない)', () => {
    const a = questXpScalar([mk({ status: 'completed', assignee: me, tags: ['code'] })], me);
    const b = questXpScalar([mk({ status: 'completed', assignee: me, tags: ['illust'] })], me);
    expect(a).toBe(b);
    expect(a).toBe(100);
  });
});

describe('isValidCompletion (owner DID 検証)', () => {
  function quest(): UserQuest {
    return mk({ uri: 'at://owner/q/1', did: 'did:plc:owner', assignee: 'did:plc:assignee' });
  }

  it('assigneeReport は assignee 本人のみ正当', () => {
    const q = quest();
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:assignee', questUri: q.uri, role: 'assigneeReport', createdAt: 'x' }, q)).toBe(true);
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:attacker', questUri: q.uri, role: 'assigneeReport', createdAt: 'x' }, q)).toBe(false);
  });

  it('requesterApproval / requesterRevision は発注者本人のみ正当', () => {
    const q = quest();
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:owner', questUri: q.uri, role: 'requesterApproval', createdAt: 'x' }, q)).toBe(true);
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:owner', questUri: q.uri, role: 'requesterRevision', createdAt: 'x' }, q)).toBe(true);
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:attacker', questUri: q.uri, role: 'requesterApproval', createdAt: 'x' }, q)).toBe(false);
  });

  it('questUri が違う completion は無効', () => {
    const q = quest();
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:owner', questUri: 'at://owner/q/2', role: 'requesterApproval', createdAt: 'x' }, q)).toBe(false);
  });

  it('assignee 未指定の quest に対する assigneeReport は無効', () => {
    const q = mk({ uri: 'at://owner/q/2', did: 'did:plc:owner' });
    expect(isValidCompletion({ uri: 'r', did: 'did:plc:assignee', questUri: q.uri, role: 'assigneeReport', createdAt: 'x' }, q)).toBe(false);
  });
});

describe('outcomeOf', () => {
  it('completed → success', () => {
    expect(outcomeOf(mk({ status: 'completed' }))).toBe('success');
  });
  it('cancelled with assignee → failure (途中で頓挫)', () => {
    expect(outcomeOf(mk({ status: 'cancelled', assignee: 'did:plc:a' }))).toBe('failure');
  });
  it('cancelled without assignee → cancelled (応募ゼロ等)', () => {
    expect(outcomeOf(mk({ status: 'cancelled' }))).toBe('cancelled');
  });
  it('open / assigned / reported → inProgress', () => {
    expect(outcomeOf(mk({ status: 'open' }))).toBe('inProgress');
    expect(outcomeOf(mk({ status: 'assigned' }))).toBe('inProgress');
    expect(outcomeOf(mk({ status: 'reported' }))).toBe('inProgress');
  });
});

describe('holdings / totalIssued / shareOf', () => {
  const ME = 'did:plc:sato';
  const OTHER = 'did:plc:tanaka';
  const issuerQuests: UserQuest[] = [
    mk({ status: 'completed', assignee: ME, rewardPoints: 12000 }),
    mk({ status: 'completed', assignee: ME, rewardPoints: 6400 }),
    mk({ status: 'completed', assignee: OTHER, rewardPoints: 4000 }),
    // 進行中はカウントから外れる
    mk({ status: 'assigned', assignee: ME, rewardPoints: 999999 }),
    mk({ status: 'open', rewardPoints: 999999 }),
  ];

  it('holdings: 自分が受け取った完了済み quest の rewardPoints 合計', () => {
    expect(holdings(issuerQuests, ME)).toBe(12000 + 6400);
  });

  it('totalIssued: 発注者の完了済み総発行量', () => {
    expect(totalIssued(issuerQuests)).toBe(12000 + 6400 + 4000);
  });

  it('shareOf: my holdings / total issued * 100', () => {
    const share = shareOf(issuerQuests, ME);
    expect(share).toBeCloseTo((12000 + 6400) / (12000 + 6400 + 4000) * 100, 5);
  });

  it('shareOf: total が 0 のとき 0 を返す', () => {
    expect(shareOf([], ME)).toBe(0);
  });
});

describe('distinctRecipients / distinctRequesters', () => {
  it('completed quest の assignee のユニーク数', () => {
    const quests: UserQuest[] = [
      mk({ status: 'completed', assignee: 'A' }),
      mk({ status: 'completed', assignee: 'B' }),
      mk({ status: 'completed', assignee: 'A' }),
      mk({ status: 'cancelled', assignee: 'C' }),
    ];
    expect(distinctRecipients(quests)).toBe(2);
  });

  it('受託者視点: 完了済み quest の did (発注者) のユニーク数', () => {
    const quests: UserQuest[] = [
      mk({ status: 'completed', did: 'did:plc:k' }),
      mk({ status: 'completed', did: 'did:plc:k' }),
      mk({ status: 'completed', did: 'did:plc:c' }),
      mk({ status: 'open', did: 'did:plc:s' }),
    ];
    expect(distinctRequesters(quests)).toBe(2);
  });
});

describe('summarize', () => {
  it('全件 + outcome 別の件数', () => {
    const quests: UserQuest[] = [
      mk({ status: 'completed' }),
      mk({ status: 'completed' }),
      mk({ status: 'cancelled', assignee: 'X' }),
      mk({ status: 'cancelled' }),
      mk({ status: 'open' }),
      mk({ status: 'assigned' }),
    ];
    expect(summarize(quests)).toEqual({
      total: 6,
      success: 2,
      failure: 1,
      cancelled: 1,
      inProgress: 2,
    });
  });
});

describe('formatQuestAnnouncement', () => {
  it('タイトル / 報酬 / 〆切 / タグ / URL を含む', () => {
    const out = formatQuestAnnouncement({
      title: '精霊のイラストを描いてくれる人募集',
      rewardPoints: 12000,
      handle: 'kojira.io',
      deadline: '2026-06-15T00:00:00Z',
      tags: ['illust', 'art'],
      questUrl: 'https://aozoraquest.app/quests/at://x',
    });
    expect(out).toContain('精霊のイラストを描いてくれる人募集');
    expect(out).toContain('kojira.ioポイント 12000 pt');
    expect(out).toContain('〆切: 6/15');
    expect(out).toContain('#illust');
    expect(out).toContain('https://aozoraquest.app/');
    // 発見タグ #aozoraquest が必ず含まれる (これが無いと掲示板に載らない)
    expect(out).toContain('#aozoraquest');
  });

  it('タグ無しでも #aozoraquest は付く', () => {
    const out = formatQuestAnnouncement({
      title: 't',
      rewardPoints: 100,
      handle: 'k',
      tags: [],
      questUrl: 'https://x',
    });
    expect(out).toContain('#aozoraquest');
  });

  it('〆切なしのときは行ごと省略', () => {
    const out = formatQuestAnnouncement({
      title: 't',
      rewardPoints: 100,
      handle: 'k',
      tags: [],
      questUrl: 'https://x',
    });
    expect(out).not.toContain('〆切');
  });
});

describe('checkIssuanceLimits', () => {
  it('0 件なら ok', () => {
    const r = checkIssuanceLimits([], NOW);
    expect(r.ok).toBe(true);
    expect(r.openCount).toBe(0);
    expect(r.todayCount).toBe(0);
  });

  it('open が上限未満なら ok', () => {
    const qs: UserQuest[] = Array.from({ length: MAX_OPEN_QUESTS_PER_USER - 1 }, (_, i) =>
      mk({ uri: `u${i}`, status: 'open', createdAt: '2026-05-01T00:00:00Z' })
    );
    const r = checkIssuanceLimits(qs, NOW);
    expect(r.ok).toBe(true);
  });

  it('open が上限以上なら NG', () => {
    const qs: UserQuest[] = Array.from({ length: MAX_OPEN_QUESTS_PER_USER }, (_, i) =>
      mk({ uri: `u${i}`, status: 'open', createdAt: '2026-05-01T00:00:00Z' })
    );
    const r = checkIssuanceLimits(qs, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/同時に/);
  });

  it('完了済みやキャンセルは open カウントに入らない', () => {
    const qs: UserQuest[] = [
      ...Array.from({ length: MAX_OPEN_QUESTS_PER_USER + 5 }, (_, i) =>
        mk({ uri: `done${i}`, status: 'completed', createdAt: '2026-05-01T00:00:00Z' })
      ),
    ];
    const r = checkIssuanceLimits(qs, NOW);
    expect(r.ok).toBe(true);
    expect(r.openCount).toBe(0);
  });

  it('24h 以内の発行数が上限以上なら NG', () => {
    const recentIso = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // 1h 前
    const qs: UserQuest[] = Array.from({ length: MAX_QUESTS_PER_DAY }, (_, i) =>
      mk({ uri: `r${i}`, status: 'cancelled', createdAt: recentIso })
    );
    const r = checkIssuanceLimits(qs, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/24 時間/);
  });

  it('24h 超過の発行はカウントされない', () => {
    const oldIso = new Date(NOW.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const qs: UserQuest[] = Array.from({ length: MAX_QUESTS_PER_DAY * 3 }, (_, i) =>
      mk({ uri: `old${i}`, status: 'cancelled', createdAt: oldIso })
    );
    const r = checkIssuanceLimits(qs, NOW);
    expect(r.ok).toBe(true);
    expect(r.todayCount).toBe(0);
  });
});

describe('複数受託 (multi-assignee)', () => {
  const owner = 'did:plc:owner';
  const A = 'did:plc:alice';
  const B = 'did:plc:bob';
  const URI = 'at://did:plc:owner/app.aozoraquest.userQuest/multi';
  const multi = (over: Partial<UserQuest> = {}): UserQuest =>
    mk({ uri: URI, did: owner, status: 'assigned', assignees: [A, B], maxAssignees: 2, rewardPoints: 500, ...over });
  const report = (who: string, at: string): QuestCompletion =>
    ({ uri: `rep-${who}-${at}`, did: who, questUri: URI, role: 'assigneeReport', createdAt: at });
  const approve = (target: string, at: string): QuestCompletion =>
    ({ uri: `app-${target}-${at}`, did: owner, questUri: URI, role: 'requesterApproval', targetAssignee: target, createdAt: at });
  const revise = (target: string, at: string): QuestCompletion =>
    ({ uri: `rev-${target}-${at}`, did: owner, questUri: URI, role: 'requesterRevision', targetAssignee: target, createdAt: at });

  describe('正規化ヘルパー', () => {
    it('questAssignees: assignees 優先・無ければ legacy assignee・両方無しは空', () => {
      expect(questAssignees(multi())).toEqual([A, B]);
      expect(questAssignees(mk({ assignee: A }))).toEqual([A]);
      expect(questAssignees(mk({}))).toEqual([]);
    });
    it('questMaxAssignees: 未指定 legacy は 1', () => {
      expect(questMaxAssignees(multi())).toBe(2);
      expect(questMaxAssignees(mk({}))).toBe(1);
    });
    it('hasOpenSlot: 空き枠の有無', () => {
      expect(hasOpenSlot(multi({ assignees: [A], maxAssignees: 2 }))).toBe(true);
      expect(hasOpenSlot(multi({ assignees: [A, B], maxAssignees: 2 }))).toBe(false);
    });
    it('completionTarget: targetAssignee → 唯一assignee → 複数で不明は null', () => {
      expect(completionTarget(approve(A, 't'), multi())).toBe(A);
      // legacy 単数: target 無し approval は唯一の assignee に解決
      const legacy = mk({ assignee: A });
      expect(completionTarget({ uri: 'x', did: owner, questUri: legacy.uri, role: 'requesterApproval', createdAt: 't' }, legacy)).toBe(A);
      // 複数受託で target 無しは曖昧 → null
      expect(completionTarget({ uri: 'x', did: owner, questUri: URI, role: 'requesterApproval', createdAt: 't' }, multi())).toBeNull();
    });
  });

  it('受託者ごとに独立して進行する (A承認済み・B報告済み未承認)', () => {
    const q = multi();
    const comps = [report(A, '01'), approve(A, '02'), report(B, '03')];
    expect(effectiveStateForAssignee(q, comps, A)).toBe('COMPLETED');
    expect(effectiveStateForAssignee(q, comps, B)).toBe('AWAITING_APPROVAL');
    expect(questLevelState(q, comps)).toBe('ASSIGNED'); // 全員 COMPLETED ではない
    expect(needsRequesterApproval(q, comps)).toBe(true); // B が承認待ち
  });

  it('全員承認で questLevelState=COMPLETED', () => {
    const q = multi();
    const comps = [report(A, '01'), approve(A, '02'), report(B, '03'), approve(B, '04')];
    expect(questLevelState(q, comps)).toBe('COMPLETED');
    expect(needsRequesterApproval(q, comps)).toBe(false);
  });

  it('1人やり直し中・1人完了の混在', () => {
    const q = multi();
    const comps = [report(A, '01'), approve(A, '02'), report(B, '03'), revise(B, '04')];
    expect(effectiveStateForAssignee(q, comps, A)).toBe('COMPLETED');
    expect(effectiveStateForAssignee(q, comps, B)).toBe('REVISION_REQUESTED');
    expect(questLevelState(q, comps)).toBe('ASSIGNED');
  });

  it('isValidCompletion: 各受託者の報告は本人なら正当 / target が集合外の承認は無効', () => {
    const q = multi();
    expect(isValidCompletion(report(A, 't'), q)).toBe(true);
    expect(isValidCompletion(report(B, 't'), q)).toBe(true);
    expect(isValidCompletion(report('did:plc:stranger', 't'), q)).toBe(false);
    expect(isValidCompletion(approve(A, 't'), q)).toBe(true);
    expect(isValidCompletion(approve('did:plc:stranger', 't'), q)).toBe(false); // target が assignees 外
    // 複数受託で target 無し approval は曖昧 → 無効 (偽の一括完了防止)
    expect(isValidCompletion({ uri: 'x', did: owner, questUri: URI, role: 'requesterApproval', createdAt: 't' }, q)).toBe(false);
  });

  it('報酬は承認された受託者それぞれに満額 (per-assignee 承認ベース)', () => {
    const q = multi(); // rewardPoints: 500
    const comps = [report(A, '01'), approve(A, '02'), report(B, '03')]; // A 承認, B 未承認
    const byUri = new Map([[URI, comps]]);
    expect(rewardForMe(q, A, comps)).toBe(500);
    expect(rewardForMe(q, B, comps)).toBe(0);
    expect(holdings([q], A, byUri)).toBe(500);
    expect(holdings([q], B, byUri)).toBe(0);
    expect(totalIssued([q], byUri)).toBe(500); // 承認済み 1 人ぶん
    expect(distinctRecipients([q], byUri)).toBe(1);
    // 全員承認後は 2 人ぶん発行
    const comps2 = [...comps, approve(B, '04')];
    const byUri2 = new Map([[URI, comps2]]);
    expect(totalIssued([q], byUri2)).toBe(1000);
    expect(distinctRecipients([q], byUri2)).toBe(2);
    expect(questXpScalar([q], A, byUri2)).toBe(questXpScalar([q], B, byUri2)); // 各自 1 件ぶん
  });

  it('後方互換: legacy 単数 assignee + status=completed は従来どおり (completions 無し fallback)', () => {
    const legacy = mk({ status: 'completed', assignee: A, rewardPoints: 300 });
    expect(rewardForMe(legacy, A)).toBe(300);
    expect(holdings([legacy], A)).toBe(300);
    expect(effectiveState(legacy, [])).toBe('COMPLETED');
    expect(questAssignees(legacy)).toEqual([A]);
  });

  it('ある受託者への承認は別の受託者の状態に漏れない (target フィルタの効き)', () => {
    const q = multi();
    const comps = [report(A, '01'), approve(A, '02')]; // A のみ報告+承認、B は何もしていない
    expect(effectiveStateForAssignee(q, comps, A)).toBe('COMPLETED');
    expect(effectiveStateForAssignee(q, comps, B)).toBe('IN_PROGRESS'); // B には漏れない
    expect(isCompletedForAssignee(q, comps, A)).toBe(true);
    expect(isCompletedForAssignee(q, comps, B)).toBe(false);
  });

  it('isCompletedForAssignee は受託者ごとに判定 (isCompleted の複数受託版)', () => {
    const q = multi();
    const comps = [report(A, '01'), approve(A, '02'), report(B, '03')];
    expect(isCompletedForAssignee(q, comps, A)).toBe(true);
    expect(isCompletedForAssignee(q, comps, B)).toBe(false); // B は報告のみ未承認
  });

  it('questAssignees: assignees の重複 DID は除去する (水増し防止)', () => {
    expect(questAssignees(multi({ assignees: [A, A, B] }))).toEqual([A, B]);
    // 重複 assignee でも totalIssued は承認された実人数ぶんに留まる
    const q = multi({ assignees: [A, A], maxAssignees: 2, rewardPoints: 500 });
    const byUri = new Map([[URI, [report(A, '01'), approve(A, '02')]]]);
    expect(totalIssued([q], byUri)).toBe(500); // A 1 人ぶん (重複で 1000 にならない)
  });

  it('questAssignees: assignees:[] (明示空) は legacy assignee に fallback する', () => {
    expect(questAssignees({ assignees: [], assignee: A })).toEqual([A]);
  });

  it('MAX_ASSIGNEES_PER_QUEST = 20 (確定値)', () => {
    expect(MAX_ASSIGNEES_PER_QUEST).toBe(20);
  });
});

describe('formatNotificationPost', () => {
  it('mention + action + title + url 構造', () => {
    const out = formatNotificationPost({
      action: 'assigned',
      recipientHandle: 'sato.bsky.social',
      questTitle: '精霊のイラスト',
      questUrl: 'https://aozoraquest.app/quests/x',
    });
    // applied 以外 (assigned 等) には #aozoraquest を付けない (TL 汚染回避)
    expect(out).toBe('@sato.bsky.social 受託者に指定されました: 精霊のイラスト → https://aozoraquest.app/quests/x');
  });

  it('applied のときだけ発見用 #aozoraquest を付ける', () => {
    const applied = formatNotificationPost({
      action: 'applied',
      recipientHandle: 'owner.bsky.social',
      questTitle: 'テスト',
      questUrl: 'https://aozoraquest.app/quests/y',
    });
    expect(applied).toContain('#aozoraquest');
    expect(applied.startsWith('@owner.bsky.social')).toBe(true);

    // ネガティブ寄りの通知はタグ無し (公開タグ TL に流さない)
    for (const action of ['reported', 'approved', 'revisionRequested'] as const) {
      const out = formatNotificationPost({ action, recipientHandle: 'h', questTitle: 't', questUrl: 'u' });
      expect(out).not.toContain('#aozoraquest');
    }
  });

  it('長いタイトルを丸めて post が長くなりすぎないようにする', () => {
    const longTitle = 'あ'.repeat(200);
    const out = formatNotificationPost({
      action: 'applied',
      recipientHandle: 'owner.bsky.social',
      questTitle: longTitle,
      questUrl: 'https://aozoraquest.app/quests/at%3A%2F%2Fdid%3Aplc%3Axxxxxxxxxxxxxxxxxxxx%2Fapp.aozoraquest.userQuest%2F3lpzzzzzz',
    });
    expect(out).toContain('…');
    // Bluesky 上限 300 grapheme に対し安全側 (タイトル丸め後)
    expect([...out].length).toBeLessThanOrEqual(300);
  });
});
