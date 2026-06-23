/**
 * 依頼クエスト (User Quest) の型定義と集計 helpers。
 *
 * 既存の `quest.ts` (システム自動生成の日次クエスト) とは別物。
 * 詳細は docs/15-user-quest.md を参照。
 */

import { XP_REWARDS } from './tuning.js';

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

function latestCreatedAt(items: QuestCompletion[]): string | null {
  let max: string | null = null;
  for (const c of items) {
    if (max === null || c.createdAt > max) max = c.createdAt;
  }
  return max;
}

/** **発注者が承認すべき状態か** (= 受託者の完了報告が届いていて、まだ承認も差し戻しもしていない)。
 *
 *  発注者の `userQuest.status` は **受託者が書き込めない** ため、受託者が完了報告しても
 *  発注者 record の status は `assigned` のまま (= `reported` は当てにできない)。よって
 *  完了判定 (`isCompleted`) と同様に **completion record から導出** する:
 *  - `requesterApproval` があれば承認済み → false
 *  - 有効な `assigneeReport` が無ければ報告未着 → false
 *  - 最後の報告 (assigneeReport) が最後の差し戻し (requesterRevision) より新しければ「承認待ち」。
 *    差し戻しの方が新しければ受託者の再報告待ちなので false。 */
export function needsRequesterApproval(q: UserQuest, completions: QuestCompletion[]): boolean {
  return effectiveState(q, completions) === 'AWAITING_APPROVAL';
}

/**
 * クエストの **実効状態 (effective state)** — 全ての表示・操作可否の唯一の真実。
 *
 * record 上の `status` は発注者しか書けないので素朴に信じてはいけない (受託者の完了報告は
 * 発注者 record に乗らず status は `assigned` のまま)。`isCompleted` / `needsRequesterApproval`
 * と同じく **completion record から導出** する (docs/17 §2.3)。
 *
 * | state | 意味 |
 * |---|---|
 * | OPEN | 募集中 (応募受付) |
 * | IN_PROGRESS | 受託確定、受託者が作業中 (未報告) |
 * | AWAITING_APPROVAL | 受託者が完了報告済み、発注者の承認待ち |
 * | REVISION_REQUESTED | 発注者がやり直し依頼、受託者の再報告待ち |
 * | COMPLETED | 承認済み = 達成 (報酬確定) |
 * | CANCELLED | 発注者が中止 |
 * | EXPIRED | 募集期限切れ (open のまま期限超過) |
 */
export type EffectiveState =
  | 'OPEN' | 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'REVISION_REQUESTED'
  | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export function effectiveState(
  q: UserQuest,
  completions: QuestCompletion[],
  now: Date = new Date(),
): EffectiveState {
  if (q.status === 'cancelled') return 'CANCELLED';
  if (isCompleted(q, completions)) return 'COMPLETED';
  if (!q.assignee) {
    return isExpired(q, now) ? 'EXPIRED' : 'OPEN';
  }
  // 受託確定済み (assignee あり)。completion record から進行を判定する。
  const valid = completions.filter(c => isValidCompletion(c, q));
  const lastReport = latestCreatedAt(valid.filter(c => c.role === 'assigneeReport'));
  if (lastReport === null) return 'IN_PROGRESS';
  const lastRevision = latestCreatedAt(valid.filter(c => c.role === 'requesterRevision'));
  if (lastRevision !== null && lastRevision > lastReport) return 'REVISION_REQUESTED';
  return 'AWAITING_APPROVAL';
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

// ─── 受託完了で得る経験値 (レベルアップ用) ──────────────

/**
 * 受託者が **完了したクエストから得た累計経験値 (XP)** (`holdings` と同じく完了集合からの
 * 派生 = 二重加算が原理的に起きない)。
 *
 * 完了 1 件あたり固定 `XP_REWARDS.questComplete` を加算する。`me` が受託者で、かつ
 * 承認済み (`status==='completed'`) のクエストのみ対象。この XP は全体 LV (playerLevel) と
 * 現職 LV (jobLevel) の両方に乗せて表示する (= 冒険で確かにレベルが上がる)。
 *
 * 引数は `status` / `assignee` だけ見るので、完全な UserQuest でも questIndex の
 * summary でも渡せる。承認の真実は発注者 record の `status='completed'` (承認時に発注者が
 * 書く) で、受託者はそれを公開 read できる。
 */
export function questXpScalar(
  receivedQuests: { status: string; assignee?: Did }[],
  me: Did,
): number {
  const n = receivedQuests.filter(q => q.status === 'completed' && q.assignee === me).length;
  return n * XP_REWARDS.questComplete;
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

/** 通知 post 本文がこの grapheme 数を超えないようタイトルを丸める (Bluesky 上限 300 の安全側)。 */
const NOTIFICATION_TITLE_MAX = 80;

export function formatNotificationPost(args: {
  action: NotificationAction;
  recipientHandle: string;
  questTitle: string;
  questUrl: string;
}): string {
  // #aozoraquest は **応募 (applied) のときだけ** 付ける。集約 Worker が無い間、
  // 発注者が応募者を発見する経路は「#aozoraquest 投稿者の PDS を走査する」のみで、
  // 応募者をこの検索網に乗せるのが目的。承認/やり直し等は当事者間の mention で
  // 足り、全部にタグを付けると (a) 発見用 TL を希釈し (b) ネガティブなやりとりまで
  // 公開タグに流す副作用があるため付けない。
  const tag = args.action === 'applied' ? ' #aozoraquest' : '';
  // タイトル + クエスト URL (https://…/board/<did>/<rkey>) で 300 grapheme を超えると
  // post が落ち、応募者が発見されなくなる。タイトルを安全側に丸める。
  const title =
    args.questTitle.length > NOTIFICATION_TITLE_MAX
      ? `${args.questTitle.slice(0, NOTIFICATION_TITLE_MAX - 1)}…`
      : args.questTitle;
  return `@${args.recipientHandle} ${ACTION_MESSAGES[args.action]}: ${title} → ${args.questUrl}${tag}`;
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
