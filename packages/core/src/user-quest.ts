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
  /**
   * @deprecated 旧・単数受託者 DID。後方互換のため **読み取り時のみ** 参照する
   * (本番 PDS に既存 record があるため)。新規書き込みでは使わず `assignees` に寄せる。
   * 読みは必ず `questAssignees(q)` を通すこと。
   */
  assignee?: Did;
  /** 受託者 DID 群 (新形式)。発注者が応募者から上限 `maxAssignees` まで個別に追加する。 */
  assignees?: Did[];
  /** 受託上限人数 (作成時に発注者が指定、1〜MAX_ASSIGNEES_PER_QUEST)。未指定の legacy は 1 とみなす。 */
  maxAssignees?: number;
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
  /**
   * `requesterApproval` / `requesterRevision` が **どの受託者向けか** を示す (複数受託対応)。
   * `assigneeReport` では未使用 (書き手 `did` が受託者自身)。
   * legacy (targetAssignee 無し) の approval/revision は「唯一の assignee 向け」と解釈する
   * (`completionTarget` 参照)。
   */
  targetAssignee?: Did;
  /** rating は MVP 未使用 (将来用) */
  rating?: number;
  comment?: string;
  createdAt: string;
}

// ─── 受託者集合の正規化 (新旧形式を吸収する読み取りの単一窓口) ─────

/** 受託上限。未指定 legacy は 1 (旧 = 単数受託)。 */
export const MAX_ASSIGNEES_PER_QUEST = 20;
export const MIN_ASSIGNEES_PER_QUEST = 1;

/** quest の受託者 DID を新旧両形式から正規化する。書き込み済み record を壊さない読み取りの窓口。 */
export function questAssignees(q: Pick<UserQuest, 'assignees' | 'assignee'>): Did[] {
  // 重複 DID は除去する (集計の水増し防止 = 防御。書き込み側 addAssignee も重複拒否するが、
  // 不正/壊れた record でも totalIssued 等が水増しされないよう読み取り窓口でも担保)。
  if (q.assignees && q.assignees.length > 0) return [...new Set(q.assignees)];
  return q.assignee ? [q.assignee] : [];
}

/** 受託上限人数 (未指定 legacy は 1)。 */
export function questMaxAssignees(q: Pick<UserQuest, 'maxAssignees'>): number {
  return q.maxAssignees ?? 1;
}

/** まだ受託者を追加できる空き枠があるか。 */
export function hasOpenSlot(q: UserQuest): boolean {
  return questAssignees(q).length < questMaxAssignees(q);
}

/**
 * completion (approval/revision) が向けた受託者を正規化する。
 * - `targetAssignee` があればそれ。
 * - 無く、受託者が唯一なら その人 (= legacy 単数時代の record 互換)。
 * - 無く、受託者が複数いて不明なら `null` (= 偽の一括完了を防ぐため無効扱い)。
 */
export function completionTarget(c: QuestCompletion, q: UserQuest): Did | null {
  if (c.targetAssignee) return c.targetAssignee;
  const list = questAssignees(q);
  return list.length === 1 ? list[0]! : null;
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

/**
 * **複数受託では `isCompleted` を完了判定に使わないこと** (= owner の approval が 1 件でも
 * あれば true を返すため、複数受託で「1 人承認 = quest 全体完了」に化ける)。
 * 報酬・冪等性・per-assignee の完了は **この関数** (= その受託者向けの承認があるか) を使う。
 * `isCompleted` は legacy 単数 / quest 全体の概況用に限定する。
 */
export function isCompletedForAssignee(
  q: UserQuest,
  completions: QuestCompletion[],
  assigneeDid: Did,
): boolean {
  return effectiveStateForAssignee(q, completions, assigneeDid) === 'COMPLETED';
}

/** completion record の owner DID が role に対応する正当な書き手かを検証する。
 *  集計・表示の前に flooring すると、不正な record を排除できる。 */
export function isValidCompletion(c: QuestCompletion, q: UserQuest): boolean {
  if (c.questUri !== q.uri) return false;
  const list = questAssignees(q);
  // 受託者の報告: 書き手が受託者集合の誰か本人であること
  if (c.role === 'assigneeReport') return list.includes(c.did);
  // 発注者の承認/やり直し: 発注者本人が書き、向け先 (target) が受託者集合内であること
  if (c.role === 'requesterApproval' || c.role === 'requesterRevision') {
    if (c.did !== q.did) return false;
    const t = completionTarget(c, q);
    return t !== null && list.includes(t);
  }
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
  if (q.status === 'completed' || q.status === 'cancelled') return false;
  // 複数受託では「誰か 1 人でも報告済み・未承認」なら発注者の番。
  return questAssignees(q).some(
    d => effectiveStateForAssignee(q, completions, d) === 'AWAITING_APPROVAL',
  );
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

/** 受託者 1 人ぶんの進行状態。複数受託では受託者ごとに独立して進む。 */
export type AssigneeState = 'IN_PROGRESS' | 'AWAITING_APPROVAL' | 'REVISION_REQUESTED' | 'COMPLETED';

/**
 * **受託者 1 人ぶん**の実効状態を completion record から導出する (複数受託の真実)。
 * その受託者の `assigneeReport` と、その人に向いた (targetAssignee 一致) `requesterApproval`
 * / `requesterRevision` だけを見る。報酬・XP・「あなたの番」判定はこれが基準。
 */
export function effectiveStateForAssignee(
  q: UserQuest,
  completions: QuestCompletion[],
  assigneeDid: Did,
): AssigneeState {
  const valid = completions.filter(c => isValidCompletion(c, q));
  // この受託者向けの承認があれば確定 COMPLETED (status を信じない = 耐故障性)
  const approved = valid.some(
    c => c.role === 'requesterApproval' && completionTarget(c, q) === assigneeDid,
  );
  if (approved) return 'COMPLETED';
  const lastReport = latestCreatedAt(
    valid.filter(c => c.role === 'assigneeReport' && c.did === assigneeDid),
  );
  if (lastReport === null) return 'IN_PROGRESS';
  const lastRevision = latestCreatedAt(
    valid.filter(c => c.role === 'requesterRevision' && completionTarget(c, q) === assigneeDid),
  );
  if (lastRevision !== null && lastRevision > lastReport) return 'REVISION_REQUESTED';
  return 'AWAITING_APPROVAL';
}

/** クエスト全体の状態 (募集枠・進行の概況)。報酬の真実は assignee 別状態を見ること。 */
export type QuestLevelState = 'OPEN' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';

export function questLevelState(
  q: UserQuest,
  completions: QuestCompletion[],
  now: Date = new Date(),
): QuestLevelState {
  if (q.status === 'cancelled') return 'CANCELLED';
  if (q.status === 'completed') return 'COMPLETED'; // 発注者が明示クローズ
  const list = questAssignees(q);
  if (list.length === 0) return isExpired(q, now) ? 'EXPIRED' : 'OPEN';
  if (list.every(d => effectiveStateForAssignee(q, completions, d) === 'COMPLETED')) return 'COMPLETED';
  return 'ASSIGNED';
}

/**
 * **後方互換ラッパ**。旧・単数受託前提の UI / 集計が引き続き動くよう、quest 全体に 1 つの
 * EffectiveState を返す。受託者 0 人なら従来どおり OPEN/EXPIRED/CANCELLED/COMPLETED、
 * 1 人以上なら「最初の (legacy では唯一の) 受託者の状態」を返す。
 * 複数受託を正しく扱う新コードは `effectiveStateForAssignee` / `questLevelState` を直接使うこと。
 */
export function effectiveState(
  q: UserQuest,
  completions: QuestCompletion[],
  now: Date = new Date(),
): EffectiveState {
  if (q.status === 'cancelled') return 'CANCELLED';
  if (q.status === 'completed') return 'COMPLETED';
  const list = questAssignees(q);
  if (list.length === 0) {
    return isExpired(q, now) ? 'EXPIRED' : 'OPEN';
  }
  return effectiveStateForAssignee(q, completions, list[0]!);
}

// ─── 発注者視点: 成功 / 失敗 / キャンセル / 進行中 ─────────

export type Outcome = 'success' | 'failure' | 'cancelled' | 'inProgress';

export function outcomeOf(q: UserQuest): Outcome {
  if (q.status === 'completed') return 'success';
  if (q.status === 'cancelled') return questAssignees(q).length > 0 ? 'failure' : 'cancelled';
  return 'inProgress';
}

// ─── ポイント集計 ──────────────────────────────────────────
//
// 複数受託では「各受託者が個別に承認された時点でそれぞれ満額」付与する (オーナー仕様)。
// よって報酬は quest.status ではなく **受託者ごとの承認 (completion record)** が真実。
// completions マップを渡すと per-assignee 承認ベースで判定し、省略時は従来の status ベースに
// fallback する (legacy 単数クエストは status='completed' のままなので壊れない)。

/** quest 1 件で me に確定した報酬。completions があれば per-assignee 承認で判定。 */
export function rewardForMe(q: UserQuest, me: Did, completions?: QuestCompletion[]): number {
  if (completions) {
    return effectiveStateForAssignee(q, completions, me) === 'COMPLETED' ? q.rewardPoints : 0;
  }
  return q.status === 'completed' && questAssignees(q).includes(me) ? q.rewardPoints : 0;
}

/** 「issuer (DID) が発注した quest のうち、me が承認されたもの」のポイント合計 */
export function holdings(
  issuerQuests: UserQuest[],
  me: Did,
  completionsByUri?: Map<AtUri, QuestCompletion[]>,
): number {
  return issuerQuests.reduce(
    (sum, q) => sum + rewardForMe(q, me, completionsByUri?.get(q.uri)),
    0,
  );
}

/** 「issuer が発行した総ポイント (= 流通量)」。複数受託では承認された人数ぶん発行される。 */
export function totalIssued(
  issuerQuests: UserQuest[],
  completionsByUri?: Map<AtUri, QuestCompletion[]>,
): number {
  return issuerQuests.reduce((sum, q) => {
    const comps = completionsByUri?.get(q.uri);
    const completedCount = comps
      ? questAssignees(q).filter(d => effectiveStateForAssignee(q, comps, d) === 'COMPLETED').length
      : (q.status === 'completed' ? questAssignees(q).length || 1 : 0);
    return sum + completedCount * q.rewardPoints;
  }, 0);
}

/** 「me が持つ issuer ポイントの総発行に対するシェア % (0-100)」 */
export function shareOf(
  issuerQuests: UserQuest[],
  me: Did,
  completionsByUri?: Map<AtUri, QuestCompletion[]>,
): number {
  const total = totalIssued(issuerQuests, completionsByUri);
  return total === 0 ? 0 : (holdings(issuerQuests, me, completionsByUri) / total) * 100;
}

// ─── 関わった人数 ──────────────────────────────────────────

/** 発注者視点: 完了済みクエストで実際に報酬を渡したユニーク受取人数 */
export function distinctRecipients(
  myIssuedQuests: UserQuest[],
  completionsByUri?: Map<AtUri, QuestCompletion[]>,
): number {
  const set = new Set<Did>();
  for (const q of myIssuedQuests) {
    const comps = completionsByUri?.get(q.uri);
    if (comps) {
      for (const d of questAssignees(q)) {
        if (effectiveStateForAssignee(q, comps, d) === 'COMPLETED') set.add(d);
      }
    } else if (q.status === 'completed') {
      for (const d of questAssignees(q)) set.add(d);
    }
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
 * 複数受託対応: completions マップを渡すと「me がその quest で承認された (per-assignee
 * COMPLETED)」件数を数える。省略時は従来どおり `status==='completed'` かつ me が受託者集合に
 * 含まれる件数に fallback する (legacy 単数クエストは status で完了が分かるので壊れない)。
 */
export function questXpScalar(
  receivedQuests: UserQuest[],
  me: Did,
  completionsByUri?: Map<AtUri, QuestCompletion[]>,
): number {
  const n = receivedQuests.filter(q => {
    const comps = completionsByUri?.get(q.uri);
    return comps
      ? effectiveStateForAssignee(q, comps, me) === 'COMPLETED'
      : q.status === 'completed' && questAssignees(q).includes(me);
  }).length;
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
