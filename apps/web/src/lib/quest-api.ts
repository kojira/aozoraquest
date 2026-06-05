/**
 * 依頼クエストの PDS read/write + Worker 集約呼び出し。
 *
 * docs/15-user-quest.md §集約インフラ:
 *  - 原本は発注者 / 応募者の各 PDS に書く
 *  - 公開リスト / 応募者一覧の発見性は Worker 経由の questIndex 集約で確保
 *  - Worker 未実装 (Phase 1 PoC 段階) では VITE_QUEST_EDGE_URL 未設定 →
 *    localStorage モック (quest-mock.ts) に fallback
 */

import { Agent } from '@atproto/api';
import type {
  UserQuest,
  QuestApplication,
  QuestCompletion,
  AtUri,
  Did,
} from '@aozoraquest/core';
import { putRecord, getRecord } from './atproto';
import { COL } from './collections';
import { mockIndex } from './quest-mock';

const EDGE_URL = (import.meta.env.VITE_QUEST_EDGE_URL as string | undefined)?.trim();

/** AT Proto の rkey として使える「時系列ソート可能 + ユニーク」な文字列。
 *  TID 仕様までは厳密に従わないが、base36(ms) + 6 文字ランダムで十分。 */
function makeRkey(): string {
  const ms = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `${ms}${rand}`;
}

// ─── 自分の PDS への write ───────────────────────────────

export interface NewQuestInput {
  title: string;
  body: string;
  tags: string[];
  targetJob?: string;
  deadline?: string;
  rewardPoints: number;
  blueskyPostUri?: AtUri;
}

/** クエストを発行する: tid 生成 → putRecord → index 同期 */
export async function createQuest(
  agent: Agent,
  did: Did,
  input: NewQuestInput,
): Promise<UserQuest> {
  const rkey = makeRkey();
  const now = new Date().toISOString();
  const record = {
    $type: COL.userQuest,
    title: input.title,
    body: input.body,
    tags: input.tags,
    targetJob: input.targetJob,
    deadline: input.deadline,
    rewardPoints: input.rewardPoints,
    blueskyPostUri: input.blueskyPostUri,
    visibility: 'public',
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(agent, COL.userQuest, rkey, record);

  const uri: AtUri = `at://${did}/${COL.userQuest}/${rkey}`;
  const quest: UserQuest = {
    uri,
    did,
    title: input.title,
    body: input.body,
    tags: input.tags,
    visibility: 'public',
    status: 'open',
    rewardPoints: input.rewardPoints,
    createdAt: now,
    updatedAt: now,
  };
  if (input.targetJob !== undefined) quest.targetJob = input.targetJob;
  if (input.deadline !== undefined) quest.deadline = input.deadline;
  if (input.blueskyPostUri !== undefined) quest.blueskyPostUri = input.blueskyPostUri;

  await notifyEdgeQuest(agent, quest);
  return quest;
}

/** クエストを取得する (URI 指定、公開 read で OK) */
export async function getQuest(agent: Agent, uri: AtUri): Promise<UserQuest | null> {
  const { repo, rkey } = parseAtUri(uri);
  const value = await getRecord<Omit<UserQuest, 'uri' | 'did'>>(agent, repo, COL.userQuest, rkey);
  if (!value) return null;
  return {
    ...value,
    uri,
    did: repo,
    // 古い record (まだ updatedAt がない) の防御
    updatedAt: value.updatedAt ?? value.createdAt,
  };
}

/** 発行者 (= 任意の did) の userQuest を時系列で list */
export async function listIssuedQuests(agent: Agent, issuerDid: Did, limit = 100): Promise<UserQuest[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: issuerDid,
    collection: COL.userQuest,
    limit,
  });
  return res.data.records.map(r => {
    const v = r.value as Omit<UserQuest, 'uri' | 'did'>;
    return {
      ...v,
      uri: r.uri,
      did: issuerDid,
      updatedAt: v.updatedAt ?? v.createdAt,
    };
  });
}

// ─── Worker 経由の集約 read ──────────────────────────────

export interface QuestIndexSummary {
  uri: AtUri;
  did: Did;
  title: string;
  tags: string[];
  rewardPoints: number;
  deadline?: string;
  status: string;
  createdAt: string;
}

export interface ApplicationIndexEntry {
  uri: AtUri;
  did: Did;
  questUri: AtUri;
  createdAt: string;
}

export interface QuestIndex {
  quests: QuestIndexSummary[];
  applications: ApplicationIndexEntry[];
  updatedAt: string;
}

/** 公開クエスト一覧を取得 (Worker → admin PDS の questIndex)。
 *  Worker 未デプロイなら mock-index に fallback。 */
export async function fetchQuestIndex(): Promise<QuestIndex> {
  if (!EDGE_URL) return mockIndex();
  try {
    const res = await fetch(`${EDGE_URL}/index`, { method: 'GET' });
    if (!res.ok) {
      console.warn('[quest-api] fetchQuestIndex failed, fallback to mock', res.status);
      return mockIndex();
    }
    return (await res.json()) as QuestIndex;
  } catch (e) {
    console.warn('[quest-api] fetchQuestIndex error, fallback to mock', e);
    return mockIndex();
  }
}

// ─── Worker への notify (= index 同期トリガ) ─────────────

async function notifyEdgeQuest(agent: Agent, q: UserQuest): Promise<void> {
  // Worker 未設定なら mock index に追加
  if (!EDGE_URL) {
    mockIndex.addQuest(q);
    return;
  }
  try {
    const token = await getBearerToken(agent);
    await fetch(`${EDGE_URL}/index/quest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ uri: q.uri }),
    });
  } catch (e) {
    console.warn('[quest-api] notifyEdgeQuest failed (will retry later)', e);
  }
}

async function getBearerToken(_agent: Agent): Promise<string | null> {
  // OAuth session の access_token を取り出す箇所は今後実装。
  // Phase 1 PoC では mock-only で動くので null で OK。
  return null;
}

// ─── ヘルパ ───────────────────────────────────────────

export function parseAtUri(uri: AtUri): { repo: Did; collection: string; rkey: string } {
  // at://did:plc:xxxx/app.aozoraquest.userQuest/3lp...
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!m || !m[1] || !m[2] || !m[3]) throw new Error(`invalid at-uri: ${uri}`);
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

export function questUrlOf(uri: AtUri, origin: string): string {
  // ブラウザ表示用 URL。/quests/<encodeURIComponent(at-uri)> 形式。
  return `${origin}/quests/${encodeURIComponent(uri)}`;
}

// 応募 / 完了は Phase 2 で実装。型のみ公開。
export type { UserQuest, QuestApplication, QuestCompletion };
