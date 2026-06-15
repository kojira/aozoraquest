import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  effectiveState,
  isCompleted,
  questXpEarned,
  type UserQuest,
} from '@aozoraquest/core';
import { COL } from '@/lib/collections';
import {
  createQuest,
  applyToQuest,
  listApplicationsFor,
  setAssignee,
  reportCompletion,
  approveCompletion,
  listCompletionsFor,
  getQuest,
  buildQuestIndexFromDirectory,
  parseAtUri,
} from '@/lib/quest-api';
import { filterForBoard } from '@/components/column-content/board-shared';

/**
 * 依頼クエストの **発行→発見→応募→受託→受託者の「受託中」フィルタ→完了報告→承認待ち→承認→
 * 双方完了→報酬** を、**2 アカウントの app-password ログイン + 実 quest-api 関数 + 実 PDS**
 * で end-to-end 検証する (Bluesky OAuth web ログインは app-password を受け付けないため、
 * UI ではなく API レベルで全フローを駆動する)。
 *
 * 安全:
 *  - 書き込み先 NSID は vitest.integration.config.ts で **隔離 env (e2etest)** に固定。
 *    本番 (env 無し = app.aozoraquest.userQuest) を絶対に触らない (下の SAFETY assert で二重防御)。
 *  - 専用テストアカウントの app-password を gitignore 済 .env.e2e.local から読む。無ければ skip。
 *  - afterAll で作成レコードを全削除。**注意**: beforeAll/afterAll は対象アカウントの
 *    e2etest NSID の userQuest/questApplication/questCompletion を**問答無用で全削除**する。
 *    必ず捨てて良いテスト専用アカウントを使うこと (実ユーザーのアカウントを入れない)。
 *
 *  実行: `pnpm --filter @aozoraquest/web test:quest-integration`
 */

// ── creds 読み込み (.env.e2e.local 手動パース) ──
try {
  const here = dirname(fileURLToPath(import.meta.url));
  // テストは e2e/ 配下、creds は apps/web/.env.e2e.local (親) にある
  const raw = readFileSync(resolve(here, '..', '.env.e2e.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && m[1].startsWith('QUEST_E2E') && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* creds 無し → skip */ }

const SERVICE = process.env.QUEST_E2E_SERVICE || 'https://bsky.social';
const A = { handle: process.env.QUEST_E2E_A_HANDLE || '', password: process.env.QUEST_E2E_A_PASSWORD || '' };
const B = { handle: process.env.QUEST_E2E_B_HANDLE || '', password: process.env.QUEST_E2E_B_PASSWORD || '' };
const HAS_CREDS = !!(A.handle && A.password && B.handle && B.password);

// localStorage polyfill (createQuest→notifyEdgeQuest→mockIndex が使う。node には無い)
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

async function deleteAll(agent: AtpAgent) {
  const did = agent.assertDid;
  for (const col of [COL.userQuest, COL.questApplication, COL.questCompletion]) {
    let cursor: string | undefined;
    do {
      const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: col, limit: 100, cursor });
      for (const r of res.data.records) {
        const { rkey } = parseAtUri(r.uri);
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection: col, rkey }).catch(() => {});
      }
      cursor = res.data.cursor;
    } while (cursor);
  }
}

describe.skipIf(!HAS_CREDS)('依頼クエスト 2 アカウント フル E2E (API / 実 PDS / e2etest NSID)', () => {
  let agentA: AtpAgent;
  let agentB: AtpAgent;
  let didA = '';
  let didB = '';

  beforeAll(async () => {
    // **SAFETY**: 3 collection すべてが隔離 env に固定されていなければ即停止 (本番 PDS 保護)。
    // これ (= 全書き込み・全削除より前) で throw すれば beforeAll/afterAll の write/delete は走らない。
    for (const col of [COL.userQuest, COL.questApplication, COL.questCompletion]) {
      if (!col.includes('.e2etest.')) {
        throw new Error(`SAFETY ABORT: ${col} は隔離 env (e2etest) ではない。本番 PDS を触る恐れ`);
      }
    }
    agentA = new AtpAgent({ service: SERVICE });
    agentB = new AtpAgent({ service: SERVICE });
    await agentA.login({ identifier: A.handle, password: A.password });
    await agentB.login({ identifier: B.handle, password: B.password });
    didA = agentA.assertDid;
    didB = agentB.assertDid;
    // 前回の残骸を掃除してから始める
    await deleteAll(agentA);
    await deleteAll(agentB);
  });

  afterAll(async () => {
    if (agentA) await deleteAll(agentA).catch(() => {});
    if (agentB) await deleteAll(agentB).catch(() => {});
  });

  it('発行→発見→応募→受託→受託中→報告→承認待ち→承認→完了→報酬', async () => {
    const dids = [didA, didB];

    // 1) A が発行
    const quest = await createQuest(agentA, didA, {
      title: `E2E依頼 ${Date.now()}`, body: 'API E2E', tags: ['code'], rewardPoints: 100,
    });
    expect(quest.status).toBe('open');

    // 2) B が発見 (両 PDS 直読み index)
    const idxB1 = await buildQuestIndexFromDirectory(agentB, dids);
    expect(idxB1.quests.some(q => q.uri === quest.uri)).toBe(true);

    // 3) B が応募
    await applyToQuest(agentB, didB, quest.uri, 'やります (E2E)');

    // 4) A の詳細で B の応募が見える (#118: discovery index 経由)
    const idxA1 = await buildQuestIndexFromDirectory(agentA, dids);
    const apps = await listApplicationsFor(undefined, quest.uri, idxA1);
    expect(apps.some(a => a.did === didB && !a.withdrawn)).toBe(true);

    // 5) A が B を受託者に指定
    const assigned = await setAssignee(agentA, quest, didB);
    expect(assigned.assignee).toBe(didB);

    // 6) B の「受託中」フィルタにクエストが出る (#126: 消えるバグの回帰)
    const idxB2 = await buildQuestIndexFromDirectory(agentB, dids);
    const assignedCol = filterForBoard({ kind: 'assigned' }, idxB2, null, null, didB);
    expect(assignedCol?.some(q => q.uri === quest.uri)).toBe(true);

    // 7) B が完了報告
    await reportCompletion(agentB, didB, assigned, '成果物: https://example.com (E2E)');

    // 8) A 視点で承認待ち (#125: status ではなく completion 由来の effectiveState)
    const compsBeforeApprove = await listCompletionsFor(undefined, assigned);
    expect(effectiveState(assigned, compsBeforeApprove)).toBe('AWAITING_APPROVAL');

    // 9) A が承認
    const { updatedQuest } = await approveCompletion(agentA, didA, assigned, 'ありがとう (E2E)');
    expect(updatedQuest.status).toBe('completed');

    // 10) 双方で完了 (PDS から読み直して確認)
    const finalQuest = await getQuest(undefined, quest.uri) as UserQuest;
    const compsAfter = await listCompletionsFor(undefined, finalQuest);
    expect(isCompleted(finalQuest, compsAfter)).toBe(true);
    expect(effectiveState(finalQuest, compsAfter)).toBe('COMPLETED');

    // 11) 報酬: B が受託完了した分の XP (#125 questXpEarned)。code タグ → 知 (int) 寄り。
    const xp = questXpEarned([finalQuest], didB);
    const total = xp.atk + xp.def + xp.agi + xp.int + xp.luk;
    expect(total).toBeGreaterThan(0);
    expect(xp.int).toBeGreaterThan(0);
  });
});
