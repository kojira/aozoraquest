/**
 * 依頼クエスト (User Quest) の型定義と集計 helpers。
 *
 * 既存の `quest.ts` (システム自動生成の日次クエスト) とは別物。
 * 詳細は docs/15-user-quest.md を参照。
 */

import type { Stat, StatVector } from './types.js';

// ─── NSID ──────────────────────────────────────────────────

export const NSID = {
  userQuest: 'app.aozoraquest.userQuest',
  questApplication: 'app.aozoraquest.questApplication',
  questCompletion: 'app.aozoraquest.questCompletion',
  questIndex: 'app.aozoraquest.questIndex',
} as const;

// ─── 型 ────────────────────────────────────────────────────

export type Did = string;
export type AtUri = string;

export type UserQuestStatus = 'open' | 'assigned' | 'reported' | 'completed' | 'cancelled';
export type UserQuestVisibility = 'public';
export type QuestCompletionRole = 'assigneeReport' | 'requesterApproval' | 'requesterRevision';

export interface UserQuest {
  /** at-uri (= 発注者 PDS 上の record の uri) */
  uri: AtUri;
  /** 発注者 DID */
  did: Did;
  title: string;
  body: string;
  tags: string[];
  /** 求めるジョブ (16 ジョブのいずれか、未指定可) */
  targetJob?: string;
  /** 募集期限 (ISO 8601)。期限内のもののみ有効と扱う */
  deadline?: string;
  visibility: UserQuestVisibility;
  status: UserQuestStatus;
  /** 受託者 DID (status >= assigned) */
  assignee?: Did;
  /** 発注者が指定する報酬ポイント (= 発注者発行通貨での pt 数)。0 以上の整数 */
  rewardPoints: number;
  /** Bluesky 告知 post の at-uri (任意) */
  blueskyPostUri?: AtUri;
  createdAt: string;
  updatedAt: string;
}

export interface QuestApplication {
  uri: AtUri;
  did: Did;
  questUri: AtUri;
  message: string;
  withdrawn: boolean;
  createdAt: string;
}

export interface QuestCompletion {
  uri: AtUri;
  /** 書き手の DID (assigneeReport なら受託者、requesterApproval/Revision なら発注者) */
  did: Did;
  questUri: AtUri;
  role: QuestCompletionRole;
  /** rating は MVP 未使用 (将来用) */
  rating?: number;
  comment?: string;
  createdAt: string;
}

// ─── 期限切れ判定 ──────────────────────────────────────────

/** 募集期限を過ぎていて、まだ open のもの = UI 上「期限切れ」と扱う */
export function isExpired(q: UserQuest, now: Date = new Date()): boolean {
  if (q.status !== 'open') return false;
  if (!q.deadline) return false;
  return new Date(q.deadline) < now;
}

// ─── 完了判定 (耐故障性: 元 record の status と approval record の両方を見る) ─

/** `requesterApproval` が書かれていれば、元 record の status が未更新 (= B 遅延) でも完了扱い。
 *
 *  **セキュリティ: approval の owner DID が発注者 (= quest.did) であることを必須にする**。
 *  AT Proto では誰でも自分の PDS に同名 record を書けるため、owner check なしだと
 *  第三者が「対象 quest URI + role=requesterApproval」の record を自 PDS に PUT するだけで
 *  完了偽造が成立してしまう (docs/15-user-quest.md §耐故障性 で指摘されたリスク)。 */
export function isCompleted(q: UserQuest, completions: QuestCompletion[]): boolean {
  if (q.status === 'completed') return true;
  return completions.some(c =>
    c.questUri === q.uri &&
    c.role === 'requesterApproval' &&
    c.did === q.did,
  );
}

/** completion record の owner DID が role に対応する正当な書き手かを検証する。
 *  集計・表示の前に flooring すると、不正な record を排除できる。 */
export function isValidCompletion(c: QuestCompletion, q: UserQuest): boolean {
  if (c.questUri !== q.uri) return false;
  if (c.role === 'assigneeReport')      return q.assignee ? c.did === q.assignee : false;
  if (c.role === 'requesterApproval')   return c.did === q.did;
  if (c.role === 'requesterRevision')   return c.did === q.did;
  return false;
}

// ─── 発注者視点: 成功 / 失敗 / キャンセル / 進行中 ─────────

export type Outcome = 'success' | 'failure' | 'cancelled' | 'inProgress';

export function outcomeOf(q: UserQuest): Outcome {
  if (q.status === 'completed') return 'success';
  if (q.status === 'cancelled') return q.assignee ? 'failure' : 'cancelled';
  return 'inProgress';
}

// ─── ポイント集計 ──────────────────────────────────────────

/** 「issuer (DID) が発注した完了済み quest のうち、me が受託したもの」のポイント合計 */
export function holdings(issuerQuests: UserQuest[], me: Did): number {
  return issuerQuests
    .filter(q => q.status === 'completed' && q.assignee === me)
    .reduce((sum, q) => sum + q.rewardPoints, 0);
}

/** 「issuer が発行した総ポイント (= 流通量)」 */
export function totalIssued(issuerQuests: UserQuest[]): number {
  return issuerQuests
    .filter(q => q.status === 'completed')
    .reduce((sum, q) => sum + q.rewardPoints, 0);
}

/** 「me が持つ issuer ポイントの総発行に対するシェア % (0-100)」 */
export function shareOf(issuerQuests: UserQuest[], me: Did): number {
  const total = totalIssued(issuerQuests);
  return total === 0 ? 0 : (holdings(issuerQuests, me) / total) * 100;
}

// ─── 関わった人数 ──────────────────────────────────────────

/** 発注者視点: 完了済みクエストで実際に報酬を渡したユニーク受取人数 */
export function distinctRecipients(myIssuedQuests: UserQuest[]): number {
  const set = new Set<Did>();
  for (const q of myIssuedQuests) {
    if (q.status === 'completed' && q.assignee) set.add(q.assignee);
  }
  return set.size;
}

/** 受託者視点: 完了済みクエストで関わった発注者のユニーク数 */
export function distinctRequesters(myReceivedQuests: UserQuest[]): number {
  const set = new Set<Did>();
  for (const q of myReceivedQuests) {
    if (q.status === 'completed') set.add(q.did);
  }
  return set.size;
}

// ─── 件数サマリ ────────────────────────────────────────────

export interface OutcomeSummary {
  total: number;
  success: number;
  failure: number;
  cancelled: number;
  inProgress: number;
}

export function summarize(quests: UserQuest[]): OutcomeSummary {
  const acc: OutcomeSummary = { total: 0, success: 0, failure: 0, cancelled: 0, inProgress: 0 };
  for (const q of quests) {
    acc.total += 1;
    acc[outcomeOf(q)] += 1;
  }
  return acc;
}

// ─── タグ → ステータス XP マッピング (docs/15-user-quest.md 付録 A) ─

type TagStatMap = Record<string, StatVector>;

const v = (atk: number, def: number, agi: number, int: number, luk: number): StatVector =>
  ({ atk, def, agi, int, luk });

/** 既定マップ。LLM 動的判定はしない。更新は kojira のみが PR で行う。 */
export const TAG_STAT_MAP: TagStatMap = {
  illust:     v(10,  0, 20, 30, 40),
  art:        v(10,  0, 20, 30, 40),
  design:     v(10,  0, 20, 30, 40),
  code:       v( 5, 15, 10, 60, 10),
  review:     v( 5, 15, 10, 60, 10),
  debug:      v( 5, 15, 10, 60, 10),
  write:      v(15, 10, 15, 50, 10),
  blog:       v(15, 10, 15, 50, 10),
  text:       v(15, 10, 15, 50, 10),
  translate:  v( 5, 25,  5, 60,  5),
  proofread:  v( 5, 25,  5, 60,  5),
  feedback:   v(20, 30, 10, 30, 10),
  advice:     v(20, 30, 10, 30, 10),
  listen:     v( 5, 30,  5, 10, 50),
  chat:       v( 5, 30,  5, 10, 50),
  counsel:    v( 5, 30,  5, 10, 50),
  research:   v(10, 20,  5, 60,  5),
  investigate:v(10, 20,  5, 60,  5),
  walk:       v(15, 20, 30,  5, 30),
  meetup:     v(15, 20, 30,  5, 30),
  offline:    v(15, 20, 30,  5, 30),
  music:      v(25,  5, 25,  5, 40),
  perform:    v(25,  5, 25,  5, 40),
  cook:       v(10, 20, 20, 20, 30),
  craft:      v(10, 20, 20, 20, 30),
  make:       v(10, 20, 20, 20, 30),
};

const DEFAULT_FLAT: StatVector = v(20, 20, 20, 20, 20);
const STATS: Stat[] = ['atk', 'def', 'agi', 'int', 'luk'];

/** タグ配列をマージしてステータス配分 (合計 100) を返す */
export function statXpDistribution(tags: string[]): StatVector {
  const normalized = tags.map(t => t.replace(/^#/, '').toLowerCase());
  const known: StatVector[] = [];
  for (const t of normalized) {
    const entry = TAG_STAT_MAP[t];
    if (entry) known.push(entry);
  }
  if (known.length === 0) return DEFAULT_FLAT;

  const summed: StatVector = v(0, 0, 0, 0, 0);
  for (const stat of STATS) {
    for (const k of known) summed[stat] += k[stat];
  }

  const total = STATS.reduce((s, k) => s + summed[k], 0);
  if (total === 0) return DEFAULT_FLAT;
  const result: StatVector = v(0, 0, 0, 0, 0);
  for (const stat of STATS) {
    result[stat] = Math.round((summed[stat] / total) * 100);
  }
  // 端数で 99 / 101 になりうるので、最大軸で吸収
  const final = STATS.reduce((s, k) => s + result[k], 0);
  if (final !== 100) {
    const maxStat = STATS.reduce((a, b) => result[a] >= result[b] ? a : b);
    result[maxStat] += 100 - final;
  }
  return result;
}

// ─── 発行スパム上限 (docs/15-user-quest.md §モデレーション) ─

export const MAX_OPEN_QUESTS_PER_USER = 3;
export const MAX_QUESTS_PER_DAY = 5;

export interface SpamLimitCheck {
  ok: boolean;
  reason?: string;
  openCount: number;
  todayCount: number;
}

/** 発注者の発行制限をチェック。自分の既存 userQuest 一覧を渡す。 */
export function checkIssuanceLimits(
  myQuests: UserQuest[],
  now: Date = new Date(),
): SpamLimitCheck {
  const openCount = myQuests.filter(q => q.status === 'open').length;
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const todayCount = myQuests.filter(q => new Date(q.createdAt) > dayAgo).length;

  if (openCount >= MAX_OPEN_QUESTS_PER_USER) {
    return {
      ok: false,
      reason: `同時に公開できるクエストは ${MAX_OPEN_QUESTS_PER_USER} 件までです。古いものをキャンセルしてから発行してください。`,
      openCount,
      todayCount,
    };
  }
  if (todayCount >= MAX_QUESTS_PER_DAY) {
    return {
      ok: false,
      reason: `24 時間以内に発行できるクエストは ${MAX_QUESTS_PER_DAY} 件までです。少し時間を置いてください。`,
      openCount,
      todayCount,
    };
  }
  return { ok: true, openCount, todayCount };
}

// ─── Bluesky 告知 / 通知 post 文面テンプレ (付録 B) ──────

export function formatQuestAnnouncement(args: {
  title: string;
  rewardPoints: number;
  handle: string;
  deadline?: string;
  tags: string[];
  questUrl: string;
}): string {
  const lines: string[] = [];
  lines.push(`【クエスト】${args.title}`);
  lines.push(`報酬: ${args.handle}ポイント ${args.rewardPoints} pt`);
  if (args.deadline) lines.push(`〆切: ${formatDateShort(args.deadline)}`);
  // #aozoraquest は掲示板の発見タグ (= これが本文に無いと searchPosts で
  // 拾えず他人の掲示板に載らない)。必ず先頭に入れ、ユーザータグを後続する。
  const userTags = args.tags.map(t => t.startsWith('#') ? t : `#${t}`);
  lines.push(['#aozoraquest', ...userTags].join(' '));
  lines.push(args.questUrl);
  return lines.join('\n');
}

export type NotificationAction =
  | 'applied'
  | 'assigned'
  | 'reported'
  | 'approved'
  | 'revisionRequested';

const ACTION_MESSAGES: Record<NotificationAction, string> = {
  applied:           '応募が来ました',
  assigned:          '受託者に指定されました',
  reported:          '完了報告が届きました',
  approved:          '承認されました',
  revisionRequested: 'やり直しを依頼されました',
};

export function formatNotificationPost(args: {
  action: NotificationAction;
  recipientHandle: string;
  questTitle: string;
  questUrl: string;
}): string {
  return `@${args.recipientHandle} ${ACTION_MESSAGES[args.action]}: ${args.questTitle} → ${args.questUrl}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
