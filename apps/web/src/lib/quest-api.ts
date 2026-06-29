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
import {
  isValidCompletion,
  isCompletedForAssignee,
  questAssignees,
  questMaxAssignees,
  hasOpenSlot,
  completionTarget,
  MAX_ASSIGNEES_PER_QUEST,
} from '@aozoraquest/core';
import { putRecord, getRecord } from './atproto';
import { listRecordsForDid, getRecordForDid } from './repo-read';
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
  /** 受託上限人数 (1〜MAX_ASSIGNEES_PER_QUEST)。未指定は 1 (単数受託)。 */
  maxAssignees?: number;
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
  // 2 人以上募集のときだけ maxAssignees を書く (1 は legacy と同義なので省略)。
  // 整数化 + [2, MAX] に clamp (UI 配線時の不正値で巨大ループ等が起きないよう API でも防御)。
  if (input.maxAssignees !== undefined && input.maxAssignees > 1) {
    quest.maxAssignees = Math.min(Math.floor(input.maxAssignees), MAX_ASSIGNEES_PER_QUEST);
  }

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

/** クエストを取得する (URI 指定)。発行者の PDS から公開 read する
 *  (自分の agent で他人 repo を読むと別ホスト時に「Could not find repo」になる)。 */
export async function getQuest(_agent: Agent | undefined, uri: AtUri): Promise<UserQuest | null> {
  const { repo, rkey } = parseAtUri(uri);
  const value = await getRecordForDid<Omit<UserQuest, 'uri' | 'did'>>(repo, COL.userQuest, rkey);
  if (!value) return null;
  return {
    ...value,
    uri,
    did: repo,
    // 古い record (まだ updatedAt がない) の防御
    updatedAt: value.updatedAt ?? value.createdAt,
  };
}

/** 発行者 (= 任意の did) の userQuest を時系列で list。
 *  対象 DID の PDS から公開 read する (他人 repo を自分の PDS 経由で読まない)。 */
export async function listIssuedQuests(_agent: Agent, issuerDid: Did, limit = 100): Promise<UserQuest[]> {
  const res = await listRecordsForDid(issuerDid, COL.userQuest, limit);
  return res.records.map(r => {
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
  /** @deprecated 旧・単数受託者 DID。読み取りは questAssignees(summary) を通すこと。 */
  assignee?: Did;
  /** 受託者 DID 群 (新形式)。受託者が「自分が受けたクエスト」を一覧で判定するのに使う。 */
  assignees?: Did[];
  /** 受託上限人数 (未指定は 1)。「空き枠あり」判定 (募集中表示) に使う。 */
  maxAssignees?: number;
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

/** クエストを questIndex の summary 形に落とす */
function questToSummary(q: UserQuest): QuestIndexSummary {
  return {
    uri: q.uri,
    did: q.did,
    title: q.title,
    tags: q.tags ?? [],
    rewardPoints: q.rewardPoints,
    ...(q.deadline ? { deadline: q.deadline } : {}),
    status: q.status,
    // legacy 単数 assignee も併載 (旧クライアント互換)。新形式は assignees。
    ...(q.assignee ? { assignee: q.assignee } : {}),
    ...(q.assignees && q.assignees.length > 0 ? { assignees: q.assignees } : {}),
    ...(q.maxAssignees !== undefined ? { maxAssignees: q.maxAssignees } : {}),
    createdAt: q.createdAt,
  };
}

/**
 * 集約 Worker が未デプロイのとき、**発見ディレクトリの DID 群から直接**
 * questIndex を組み立てる (共鳴 TL と同じく各 PDS を読むクライアント集約)。
 *
 * これがないと fetchQuestIndex は localStorage モックに落ち、quest が
 * 「発行者本人の端末でしか見えない」状態になる (= 他人に見えないバグ)。
 * 各 DID の userQuest / questApplication を listRecords で読み、
 * 公開 quest 一覧と応募 index を作る。一部 DID の失敗は無視して続行する。
 */
/** items を最大 limit 並列で fn にかけ、Promise.allSettled 相当の結果を返す。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const settled = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    results.push(...settled);
  }
  return results;
}

export async function buildQuestIndexFromDirectory(
  _agent: Agent,
  dids: Did[],
  limitPerRepo = 100,
): Promise<QuestIndex> {
  // 重複 DID を除去 (自分 + directory の和集合などで重なりうる)
  const unique = Array.from(new Set(dids));
  // plc.directory / 各 PDS への過大な同時リクエストを避けるため並列数を絞る
  // (最大 60 DID を一気に叩くと plc.directory に 429 を食らい欠落しうる)
  const results = await mapWithConcurrency(unique, 8, async (did) => {
      // 各 DID の PDS から公開 read する (自分の PDS 経由だと別ホストの repo を読めない)
      const [questsRes, appsRes] = await Promise.allSettled([
        listRecordsForDid(did, COL.userQuest, limitPerRepo),
        listRecordsForDid(did, COL.questApplication, limitPerRepo),
      ]);
      const quests: QuestIndexSummary[] = [];
      const applications: ApplicationIndexEntry[] = [];
      if (questsRes.status === 'fulfilled') {
        for (const r of questsRes.value.records) {
          const v = r.value as Omit<UserQuest, 'uri' | 'did'>;
          quests.push(questToSummary({ ...v, uri: r.uri, did, updatedAt: v.updatedAt ?? v.createdAt }));
        }
      }
      if (appsRes.status === 'fulfilled') {
        for (const r of appsRes.value.records) {
          const v = r.value as { questUri?: AtUri; createdAt?: string };
          if (typeof v.questUri === 'string') {
            applications.push({
              uri: r.uri,
              did,
              questUri: v.questUri,
              createdAt: v.createdAt ?? '',
            });
          }
        }
      }
      return { quests, applications };
    });

  const quests: QuestIndexSummary[] = [];
  const applications: ApplicationIndexEntry[] = [];
  const seenQ = new Set<string>();
  const seenA = new Set<string>();
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    for (const q of res.value.quests) {
      if (seenQ.has(q.uri)) continue;
      seenQ.add(q.uri);
      quests.push(q);
    }
    for (const a of res.value.applications) {
      if (seenA.has(a.uri)) continue;
      seenA.add(a.uri);
      applications.push(a);
    }
  }
  // 新しい順 (createdAt 降順) に並べる
  quests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { quests, applications, updatedAt: new Date().toISOString() };
}

export const DISCOVERY_TAG = 'aozoraquest';
/** 集約対象 DID 数の上限 (1 DID = 2 listRecords なので過大にしない) */
const MAX_DISCOVERY_DIDS = 60;

/**
 * questIndex を「発見ディレクトリ + #aozoraquest 投稿者 + 自分」の和集合から
 * 集約する。集約 Worker 未デプロイ時の board の正規ルート。
 *
 * directory は admin キュレーションなので、**まだ directory 未登録でも告知
 * (#aozoraquest 投稿) した発行者をその場の検索で拾う** ことで、登録待ち
 * (毎時 cron) を待たずに quest が他人へ見えるようにする。過去の quest も
 * その発行者の userQuest を listRecords で全件読むので一緒に出る。
 */
export async function buildQuestIndexViaDiscovery(
  agent: Agent,
  directoryDids: Did[],
  selfDid?: Did | null,
): Promise<QuestIndex> {
  const dids = new Set<string>(directoryDids);
  if (selfDid) dids.add(selfDid);
  // #aozoraquest 投稿者を拾う (告知した発行者を即 discovery)。検索失敗は無視。
  try {
    let cursor: string | undefined;
    for (let page = 0; page < 2 && dids.size < MAX_DISCOVERY_DIDS; page++) {
      const res = await agent.app.bsky.feed.searchPosts({
        q: `#${DISCOVERY_TAG}`,
        limit: 100,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      for (const post of res.data.posts) {
        const d = post.author?.did;
        if (d) dids.add(d);
        if (dids.size >= MAX_DISCOVERY_DIDS) break;
      }
      const next = res.data.cursor;
      if (!next || next === cursor) break;
      cursor = next;
    }
  } catch (e) {
    console.warn('[quest-api] discovery search failed, directory のみで集約', e);
  }
  return buildQuestIndexFromDirectory(agent, Array.from(dids).slice(0, MAX_DISCOVERY_DIDS));
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

/**
 * クエスト詳細への **アプリ内パス**。`/board/<repo did>/<rkey>` の clean segment 形式。
 *
 * 旧実装は at-uri 全体を 1 つの param に `encodeURIComponent` で押し込んでいたが、
 * at-uri はスラッシュを含むため新規ロード時に `%2F` が `/` に正規化され、React Router の
 * 単一セグメント param にマッチせず 404 になっていた (アプリ内 <Link> だけ動く非対称)。
 * 既存の `profile/:handle/post/:rkey` と同じく、スラッシュを含まない 2 つの clean segment
 * (repo DID + rkey) に分解する。collection は常に userQuest なので URL に含めない。
 */
export function questPath(uri: AtUri): string {
  const { repo, rkey } = parseAtUri(uri);
  return `/board/${repo}/${rkey}`;
}

/** {@link questPath} の絶対 URL 版 (Bluesky 投稿に埋め込む共有リンク用)。 */
export function questUrlOf(uri: AtUri, origin: string): string {
  return `${origin}${questPath(uri)}`;
}

/** `/board/:repo/:rkey` の 2 param から userQuest の at-uri を復元する。
 *  collection は URL に含めず常に `COL.userQuest` で組む。これは `getQuest` が元々 uri の
 *  collection を無視して `COL.userQuest` で読む挙動と一致し、production リンクを dev で開いた
 *  ときの cross-env collection mismatch も解消する。board で別 collection を開く要件が出たら
 *  ここと getQuest の両方を直す。 */
export function questUriFromParams(repo: string, rkey: string): AtUri {
  return `at://${repo}/${COL.userQuest}/${rkey}`;
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

/** 特定 quest への応募一覧を、index で発見した応募者 PDS から fetch する。
 *
 *  `index` を渡すと、それ (= 掲示板と同じ PDS 直読みの discovery index) の
 *  applications を使う。これにより集約 Worker が未デプロイでも **他ユーザーの
 *  応募が発注者に見える** (応募者が #aozoraquest 投稿で発見可能な前提)。
 *  未指定なら従来どおり fetchQuestIndex (Worker or localStorage モック) に落ちる。 */
export async function listApplicationsFor(
  _agent: Agent | undefined,
  questUri: AtUri,
  index?: QuestIndex,
): Promise<QuestApplication[]> {
  const idx = index ?? await fetchQuestIndex();
  const entries = idx.applications.filter(a => a.questUri === questUri);
  const out: QuestApplication[] = [];
  for (const e of entries) {
    try {
      const { rkey } = parseAtUri(e.uri);
      const v = await getRecordForDid<Omit<QuestApplication, 'uri' | 'did'>>(
        e.did, COL.questApplication, rkey,
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

/** ある DID が「受託したクエスト」(= assignee==did) の一覧。
 *  自分の応募 (questApplication) から quest URI を集め、各 quest を発注者 PDS から
 *  resolve して assignee==did のものだけ返す。discovery 不要で軽量 (応募数ぶんの read)。
 *  経験値 (questXpScalar) 算出や受託履歴で使う。 */
export async function listReceivedQuests(agent: Agent, did: Did): Promise<UserQuest[]> {
  const apps = await listMyApplications(agent, did);
  const questUris = Array.from(new Set(apps.map(a => a.questUri)));
  const out: UserQuest[] = [];
  for (const u of questUris) {
    try {
      const q = await getQuest(agent, u);
      if (q && questAssignees(q).includes(did)) out.push(q);
    } catch (e) {
      console.warn('[quest-api] resolve received quest failed', u, e);
    }
  }
  return out;
}

/** ある DID が出した応募一覧 (withdrawn 含む。フィルタは UI 側で)。
 *  対象 DID の PDS から公開 read する (ポートフォリオで他人の did も渡るため)。 */
export async function listMyApplications(_agent: Agent, did: Did, limit = 100): Promise<QuestApplication[]> {
  const res = await listRecordsForDid(did, COL.questApplication, limit);
  return res.records.map(r => {
    const v = r.value as Omit<QuestApplication, 'uri' | 'did'>;
    return { ...v, uri: r.uri, did };
  });
}

// ─── Phase 2: 受託者指定 (発注者が quest record を更新) ───

/**
 * 書き込み record の legacy `assignee` を新形式 `assignees` に同期する (in-place)。
 * **単数 (assignees が 1 名) のうちは legacy `assignee` も併記** する。これは段階3 未改修の
 * UI (board-detail / board-shared / quest-actionable / portfolio が `quest.assignee` を直読み)
 * が単数受託で壊れないための後方互換措置。複数 (2 名以上) は単数フィールドで表せないので外す
 * (複数受託は段階3 の UI 配線が揃ってから作成可能になる)。
 */
function syncLegacyAssignee(q: UserQuest): void {
  const list = q.assignees ?? [];
  if (list.length === 1) q.assignee = list[0]!;
  else delete q.assignee;
}

/** 受託者を 1 名追加する (発注者操作)。上限超過は拒否、重複は no-op。
 *  書き込みは新形式 `assignees` に寄せる (単数のうちは legacy assignee も併記 = 後方互換)。 */
export async function addAssignee(
  agent: Agent,
  quest: UserQuest,
  assignee: Did,
): Promise<UserQuest> {
  const list = questAssignees(quest);
  if (list.includes(assignee)) return quest; // 冪等 (重複追加は何もしない)
  if (list.length >= questMaxAssignees(quest)) {
    throw new Error('受託上限に達しています');
  }
  const { rkey } = parseAtUri(quest.uri);
  const updated: UserQuest = {
    ...quest,
    assignees: [...list, assignee],
    status: 'assigned',
    updatedAt: new Date().toISOString(),
  };
  syncLegacyAssignee(updated);
  await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
  await notifyEdgeQuest(agent, updated);
  return updated;
}

/** 受託者を 1 名外す (発注者操作)。全員外れたら status を open に戻す。 */
export async function removeAssignee(
  agent: Agent,
  quest: UserQuest,
  assignee: Did,
): Promise<UserQuest> {
  const assignees = questAssignees(quest).filter(d => d !== assignee);
  const { rkey } = parseAtUri(quest.uri);
  const updated: UserQuest = {
    ...quest,
    assignees,
    status: assignees.length === 0 ? 'open' : 'assigned',
    updatedAt: new Date().toISOString(),
  };
  syncLegacyAssignee(updated);
  await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
  await notifyEdgeQuest(agent, updated);
  return updated;
}

/** @deprecated `addAssignee` を使う。単数指定の後方互換 alias。 */
export async function setAssignee(
  agent: Agent,
  quest: UserQuest,
  assignee: Did,
): Promise<UserQuest> {
  return addAssignee(agent, quest, assignee);
}

// ─── Phase 2: 完了報告 / 承認 / やり直し ─────────────

async function writeCompletion(
  agent: Agent,
  writerDid: Did,
  questUri: AtUri,
  role: QuestCompletion['role'],
  comment?: string,
  targetAssignee?: Did,
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
  // approval / revision は「どの受託者向けか」を必ず記録する (複数受託の per-assignee 判定用)。
  if (targetAssignee !== undefined) c.targetAssignee = targetAssignee;
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
  targetAssignee?: Did,
): Promise<{ completion: QuestCompletion; updatedQuest: UserQuest }> {
  // targetAssignee 省略時は唯一の受託者に解決 (単数 quest の後方互換)。
  const target = targetAssignee ?? questAssignees(quest)[0];
  if (!target) throw new Error('受託者がいません');
  // 書き込み前ガード: target が受託者集合内であること (読み取り時 isValidCompletion でも弾くが、
  // ゴミ approval record を書かないよう書き込み側でも防御)。
  if (!questAssignees(quest).includes(target)) throw new Error('指定した受託者はこのクエストの受託者ではありません');

  const existing = await listCompletionsFor(undefined, quest);
  // 冪等性: **この受託者向け**の承認が既にあれば二重 approval を書かない (= 二重発行防止)。
  // 複数受託では「他の受託者が承認済み」でもこの受託者は未承認なので、per-assignee で判定する。
  if (isCompletedForAssignee(quest, existing, target)) {
    const approval = existing.find(
      c => c.role === 'requesterApproval' && completionTarget(c, quest) === target,
    );
    if (approval) return { completion: approval, updatedQuest: quest };
  }
  // 順序: (A) approval record → (B) quest status → (C) index 同期。(A) が真実 (docs/15 §耐故障性)。
  const completion = await writeCompletion(
    agent, requesterDid, quest.uri, 'requesterApproval', comment, target,
  );
  // quest 全体 status を completed にするのは「全受託者が承認済み かつ 空き枠なし」のときだけ。
  // 途中 (一部だけ承認 / まだ募集枠が残る) は assigned のまま据え置き、報酬は per-assignee で確定。
  const after = [...existing, completion];
  const allApproved = questAssignees(quest).every(d => isCompletedForAssignee(quest, after, d));
  let updated = quest;
  if (allApproved && !hasOpenSlot(quest)) {
    const { rkey } = parseAtUri(quest.uri);
    updated = { ...quest, status: 'completed', updatedAt: new Date().toISOString() };
    await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
    mockIndex.updateQuestStatus(quest.uri, 'completed');
  }
  await notifyEdgeQuest(agent, updated);
  return { completion, updatedQuest: updated };
}

/** 発注者が特定の受託者に「やり直し」を依頼。quest 全体 status は assigned のまま
 *  (他の受託者が進行中の可能性があるため、status は据え置き = per-assignee で管理)。 */
export async function requestRevision(
  agent: Agent,
  requesterDid: Did,
  quest: UserQuest,
  comment: string,
  targetAssignee?: Did,
): Promise<{ completion: QuestCompletion; updatedQuest: UserQuest }> {
  const target = targetAssignee ?? questAssignees(quest)[0];
  if (!target) throw new Error('受託者がいません');
  if (!questAssignees(quest).includes(target)) throw new Error('指定した受託者はこのクエストの受託者ではありません');
  const completion = await writeCompletion(
    agent, requesterDid, quest.uri, 'requesterRevision', comment, target,
  );
  // status は assigned に揃える (completed/reported から戻す)。複数受託では元々 assigned。
  let updated = quest;
  if (quest.status !== 'assigned') {
    const { rkey } = parseAtUri(quest.uri);
    updated = { ...quest, status: 'assigned', updatedAt: new Date().toISOString() };
    await putRecord(agent, COL.userQuest, rkey, toRecord(updated, COL.userQuest));
    mockIndex.updateQuestStatus(quest.uri, 'assigned');
  }
  return { completion, updatedQuest: updated };
}

/** quest に紐付く completion レコードを発注者・受託者の PDS から fetch して時系列で返す */
export async function listCompletionsFor(
  _agent: Agent | undefined,
  quest: UserQuest,
): Promise<QuestCompletion[]> {
  const dids = new Set<Did>();
  dids.add(quest.did);
  // 全受託者の PDS から completion を読む (複数受託では各自が自分の PDS に報告を書く)。
  for (const a of questAssignees(quest)) dids.add(a);

  const out: QuestCompletion[] = [];
  for (const did of dids) {
    try {
      // 各 DID の PDS から公開 read (自分の PDS 経由だと別ホストの repo を読めない)
      const res = await listRecordsForDid(did, COL.questCompletion, 100);
      for (const r of res.records) {
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

/**
 * 報酬/XP 集計を per-assignee 承認ベースで正しく出すための completion マップを作る。
 *
 * **multi かつ未完了 (status が completed/cancelled でない) のクエストだけ** completion を読む。
 * 単数クエストや全員承認済み (status='completed') のクエストは status fallback が実値と一致する
 * ため取得しない (= 無駄な PDS read を避ける)。複数受託で「一部だけ承認・quest 未完了」のときに
 * 承認済み受託者の報酬を計上するのが目的。
 */
export async function loadCompletionsByUri(quests: UserQuest[]): Promise<Map<AtUri, QuestCompletion[]>> {
  const map = new Map<AtUri, QuestCompletion[]>();
  const targets = quests.filter(
    q => questMaxAssignees(q) > 1 && q.status !== 'completed' && q.status !== 'cancelled',
  );
  await Promise.all(targets.map(async (q) => {
    try { map.set(q.uri, await listCompletionsFor(undefined, q)); }
    catch (e) { console.warn('[quest-api] loadCompletionsByUri', q.uri, e); }
  }));
  return map;
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
