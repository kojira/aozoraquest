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
import { isValidCompletion } from '@aozoraquest/core';
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

  await putRecord(agent, COL.userQuest, rkey, toRecord(quest, COL.userQuest));
  await notifyEdgeQuest(agent, quest);
  return quest;
}

/** quest record を update (発注者がキャンセル / 期限変更 / status 更新するときに使う共通関数) */
export async function updateQuest(
  agent: Agent,
  quest: UserQuest,
): Promise<UserQuest> {
  const { rkey } = parseAtUri(quest.uri);
  const next: UserQuest = { ...quest, updatedAt: new Date().toISOString() };
  await putRecord(agent, COL.userQuest, rkey, toRecord(next, COL.userQuest));
  await notifyEdgeQuest(agent, next);
  return next;
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

/** at-uri を厳格にパース。
 *  - rkey に `/` を含む uri (= AT Proto 仕様外) は invalid 扱いで throw
 *  - 不正 uri は呼び出し側で必ず catch すること */
export function parseAtUri(uri: AtUri): { repo: Did; collection: string; rkey: string } {
  // at://did:plc:xxxx/app.aozoraquest.userQuest/3lp...
  // rkey は AT Proto 仕様では `[A-Za-z0-9._:~-]` のみで `/` を含まない。
  // collection と rkey の境界が曖昧にならないよう、rkey 側を厳格化。
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([A-Za-z0-9._:~-]+)$/);
  if (!m || !m[1] || !m[2] || !m[3]) throw new Error(`invalid at-uri: ${uri}`);
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

/** at-uri から発注者 (owner) DID だけを取り出す。集計時の owner check 用。
 *  不正 uri なら null を返す (集計は無視するのが安全)。 */
export function questOwnerDidOf(uri: AtUri): Did | null {
  try {
    return parseAtUri(uri).repo;
  } catch {
    return null;
  }
}

/** PDS write 用に「undefined / null フィールドを落とす + $type 付与」を行う。
 *  exactOptionalPropertyTypes 下で `{ ...x }` を put すると undefined が
 *  そのまま PDS に書き込まれる可能性があるため、send 直前に必ず通す。
 *  null も Lexicon 違反になりうるので同じく落とす。
 *  uri / did は record 自体には含めない (rkey や URI は別途扱う)。 */
export function toRecord<T extends object>(value: T, $type: string, exclude: string[] = ['uri', 'did']): Record<string, unknown> {
  const out: Record<string, unknown> = { $type };
  for (const [k, v] of Object.entries(value)) {
    if (exclude.includes(k)) continue;
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

export function questUrlOf(uri: AtUri, origin: string): string {
  // ブラウザ表示用 URL。/quests/<encodeURIComponent(at-uri)> 形式。
  return `${origin}/quests/${encodeURIComponent(uri)}`;
}

// ─── Phase 2: 応募 ────────────────────────────────────

export async function applyToQuest(
  agent: Agent,
  applicantDid: Did,
  questUri: AtUri,
  message: string,
): Promise<QuestApplication> {
  const rkey = makeRkey();
  const now = new Date().toISOString();
  const uri: AtUri = `at://${applicantDid}/${COL.questApplication}/${rkey}`;
  const app: QuestApplication = {
    uri,
    did: applicantDid,
    questUri,
    message,
    withdrawn: false,
    createdAt: now,
  };
  await putRecord(agent, COL.questApplication, rkey, toRecord(app, COL.questApplication));
  await notifyEdgeApplication(agent, app);
  return app;
}

export async function withdrawApplication(
  agent: Agent,
  app: QuestApplication,
): Promise<void> {
  const { rkey } = parseAtUri(app.uri);
  const next: QuestApplication = { ...app, withdrawn: true };
  await putRecord(agent, COL.questApplication, rkey, toRecord(next, COL.questApplication));
}

/** 特定 quest への応募一覧を、index で発見した応募者 PDS から fetch する */
export async function listApplicationsFor(
  agent: Agent,
  questUri: AtUri,
): Promise<QuestApplication[]> {
  const idx = await fetchQuestIndex();
  const entries = idx.applications.filter(a => a.questUri === questUri);
  const out: QuestApplication[] = [];
  for (const e of entries) {
    try {
      const { rkey } = parseAtUri(e.uri);
      const v = await getRecord<Omit<QuestApplication, 'uri' | 'did'>>(
        agent, e.did, COL.questApplication, rkey,
      );
      if (v) {
        // withdrawn も含めて返す (= UI 側で「取り下げ済み」表示するため)
        out.push({ ...v, uri: e.uri, did: e.did });
      }
    } catch (err) {
      console.warn('[quest-api] fetch application failed', e.uri, err);
    }
  }
  // 古い順 (応募順)
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 自分が出した応募一覧 (withdrawn も含めて返す。フィルタは UI 側で) */
export async function listMyApplications(agent: Agent, myDid: Did, limit = 100): Promise<QuestApplication[]> {
  const res = await agent.com.atproto.repo.listRecords({
    repo: myDid,
    collection: COL.questApplication,
    limit,
  });
  return res.data.records
    .map(r => {
      const v = r.value as Omit<QuestApplication, 'uri' | 'did'>;
      return { ...v, uri: r.uri, did: myDid };
    });
}

// ─── Phase 2: 受託者指定 (発注者が quest record を更新) ───

export async function setAssignee(
  agent: Agent,
  quest: UserQuest,
  assignee: Did,
): Promise<UserQuest> {
  const { rkey } = parseAtUri(quest.uri);
  const updated: UserQuest = {
    ...quest,
    assignee,
    status: 'assigned',
    updatedAt: new Date().toISOString(),
  };
  await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
  await notifyEdgeQuest(agent, updated);
  return updated;
}

// ─── Phase 2: 完了報告 / 承認 / やり直し ─────────────

async function writeCompletion(
  agent: Agent,
  writerDid: Did,
  questUri: AtUri,
  role: QuestCompletion['role'],
  comment?: string,
): Promise<QuestCompletion> {
  const rkey = makeRkey();
  const now = new Date().toISOString();
  const c: QuestCompletion = {
    uri: `at://${writerDid}/${COL.questCompletion}/${rkey}`,
    did: writerDid,
    questUri,
    role,
    createdAt: now,
  };
  if (comment !== undefined) c.comment = comment;
  await putRecord(agent, COL.questCompletion, rkey, toRecord(c, COL.questCompletion));
  return c;
}

export async function reportCompletion(
  agent: Agent,
  assigneeDid: Did,
  quest: UserQuest,
  comment?: string,
): Promise<QuestCompletion> {
  const completion = await writeCompletion(agent, assigneeDid, quest.uri, 'assigneeReport', comment);
  // 元 quest の status を `reported` に進める (受託者は自分の record しか書けないので
  // ここでは発注者の quest を更新できない。発注者側が次回読み込み時に進める運用)。
  // ただ UI 上の即時反映のため mock index は更新する。
  mockIndex.updateQuestStatus(quest.uri, 'reported');
  return completion;
}

/**
 * 発注者が完了報告を承認 (= ポイント発行 + XP 付与 が確定するトリガ)。
 * 元 quest record の status を completed に更新 (= reconciliation の真実 B)。
 */
export async function approveCompletion(
  agent: Agent,
  requesterDid: Did,
  quest: UserQuest,
  comment?: string,
): Promise<{ completion: QuestCompletion; updatedQuest: UserQuest }> {
  // 順序: (A) approval record → (B) quest status → (C) index 同期。
  // (A) が真実、B-C は派生 (docs/15-user-quest.md §耐故障性)。
  const completion = await writeCompletion(agent, requesterDid, quest.uri, 'requesterApproval', comment);
  const { rkey } = parseAtUri(quest.uri);
  const updated: UserQuest = { ...quest, status: 'completed', updatedAt: new Date().toISOString() };
  await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
  // (B) 成功後にのみ index と mock を更新する。B 失敗時は次回 reconciliation で
  // 自分の approval record から完了済みと判定される (= eventual consistency)。
  mockIndex.updateQuestStatus(quest.uri, 'completed');
  await notifyEdgeQuest(agent, updated);
  return { completion, updatedQuest: updated };
}

/** 発注者が「やり直し」を依頼。元 quest の status を assigned に戻す。 */
export async function requestRevision(
  agent: Agent,
  requesterDid: Did,
  quest: UserQuest,
  comment: string,
): Promise<{ completion: QuestCompletion; updatedQuest: UserQuest }> {
  const completion = await writeCompletion(agent, requesterDid, quest.uri, 'requesterRevision', comment);
  const { rkey } = parseAtUri(quest.uri);
  const updated: UserQuest = { ...quest, status: 'assigned', updatedAt: new Date().toISOString() };
  await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
  mockIndex.updateQuestStatus(quest.uri, 'assigned');
  return { completion, updatedQuest: updated };
}

/** quest に紐付く completion レコードを発注者・受託者の PDS から fetch して時系列で返す */
export async function listCompletionsFor(
  agent: Agent,
  quest: UserQuest,
): Promise<QuestCompletion[]> {
  const dids = new Set<Did>();
  dids.add(quest.did);
  if (quest.assignee) dids.add(quest.assignee);

  const out: QuestCompletion[] = [];
  for (const did of dids) {
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: COL.questCompletion,
        limit: 100,
      });
      for (const r of res.data.records) {
        const v = r.value as Omit<QuestCompletion, 'uri' | 'did'>;
        if (v.questUri !== quest.uri) continue;
        const c: QuestCompletion = { ...v, uri: r.uri, did };
        // owner DID 検証: assigneeReport は assignee 本人、approval/revision は
        // 発注者本人が書いた record だけを正当と扱う (= 偽造防止)。
        if (!isValidCompletion(c, quest)) {
          console.warn('[quest-api] dropping invalid completion (owner mismatch)', r.uri, c.role);
          continue;
        }
        out.push(c);
      }
    } catch (err) {
      console.warn('[quest-api] listCompletions fetch failed', did, err);
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function notifyEdgeApplication(_agent: Agent, app: QuestApplication): Promise<void> {
  if (!EDGE_URL) {
    mockIndex.addApplication({
      uri: app.uri,
      did: app.did,
      questUri: app.questUri,
      createdAt: app.createdAt,
    });
    return;
  }
  try {
    await fetch(`${EDGE_URL}/index/application`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uri: app.uri }),
    });
  } catch (e) {
    console.warn('[quest-api] notifyEdgeApplication failed', e);
  }
}

// Phase 2 で追加した write/read。型の re-export は不要 (`@aozoraquest/core` から直接 import 可能)
export type { UserQuest, QuestApplication, QuestCompletion };
