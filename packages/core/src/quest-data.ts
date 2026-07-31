/**
 * **ゲーム内クエスト** (#423)。NPC が発注し、達成すると報酬が出る。
 *
 * デイリークエスト (投稿系) や依頼クエスト (ユーザー間) とは別物で、
 * **ワールド内で完結する** DQ 風のおつかい。定義はエディタで作り、管理者 PDS の
 * `world.quests` に置く (モンスター #419 と同じ流儀)。
 *
 * ## 進行と報酬はサーバーが権威
 *
 * 進行 (討伐数) は `GameState.quest` に、達成済みは `GameState.questsDone` に持ち、
 * **報酬 (パワー・アイテム) は edge が検証して付与する**。client の自己申告では
 * 1 パワーも増えない (docs/21 のサーバー権威)。
 *
 * 達成条件は**サーバーが検証できるものだけ**にする:
 * - defeat: 対象モンスターの討伐数 (勝利時に edge が数える)
 * - collect: 素材の所持数 (権威在庫を見る。達成時に**引き取る**)
 * 「場所に行く」「人と話す」は検証手段が固まってから足す。
 */
import { MONSTERS_BY_ID, ITEMS } from './battle.js';
import { allNpcs } from './npc-data.js';
import { assertItemRequirements, isFlagName, type ItemRequirement } from './scenario.js';

export class QuestDataError extends Error {}

export type QuestObjective =
  | { kind: 'defeat'; monsterId: string; count: number }
  | { kind: 'collect'; itemId: string; count: number };

export interface GameQuestDef {
  id: string;
  /** 一覧・通知に出す名前。 */
  title: string;
  /** 発注する NPC。ぶつかると依頼を話す。 */
  npcId: string;
  /** 依頼のセリフ (受ける前)。読み終えると受注する。 */
  intro: string[];
  /** 達成時のセリフ (お礼)。 */
  done: string[];
  /** 進行中に話しかけたときのセリフ (省略時は「たのんだよ」風の既定)。 */
  progress?: string[];
  objective: QuestObjective;
  /** 報酬。省略可 (お礼のセリフだけのクエストも作れる)。 */
  reward?: { power?: number; itemId?: string; count?: number };
  /** **解禁フラグ** (#545)。すべて立つまでこのクエストは受注できない (NPC も依頼を話さない)。 */
  requireFlags?: string[];
  /** **解禁に要る持ち物** (#426)。フラグの代わりに「これを持っていたら受けられる」を書ける。 */
  requireItems?: ItemRequirement[];
}

export interface GameQuestsRecord {
  quests: GameQuestDef[];
  updatedAt: string;
}

export const MAX_GAME_QUESTS = 200;
export const MAX_QUEST_LINE = 120;
/** 報酬パワーの上限 (打ち間違いで経済を壊さない)。 */
export const MAX_QUEST_REWARD_POWER = 500;

let quests: GameQuestDef[] = [];
let byId = new Map<string, GameQuestDef>();
let byNpc = new Map<string, GameQuestDef>();

/**
 * 検証して差し替える。`null` で全解除。**壊れた 1 件で全体を落とす**。
 *
 * npcId / monsterId / itemId の実在は**読み込み順に依存する** — NPC・モンスター・
 * アイテムのレコードを先に適用してから呼ぶこと (world-authoring がその順で読む)。
 */
export function setGameQuests(list: readonly GameQuestDef[] | null): void {
  const next = list ?? [];
  if (next.length > MAX_GAME_QUESTS) throw new QuestDataError(`クエストが多すぎる (${next.length} > ${MAX_GAME_QUESTS})`);
  const ids = new Set<string>();
  const npcIds = new Set(allNpcs().map((n) => n.id));
  const perNpc = new Map<string, string>();
  for (const q of next) {
    const where = q?.id ?? '(id なし)';
    if (!q || typeof q.id !== 'string' || q.id.trim() === '') throw new QuestDataError('クエストの id が空');
    if (ids.has(q.id)) throw new QuestDataError(`id が重複 (${q.id})`);
    ids.add(q.id);
    if (typeof q.title !== 'string' || q.title.trim() === '') throw new QuestDataError(`${where}: タイトルが空`);
    if (!npcIds.has(q.npcId)) throw new QuestDataError(`${where}: NPC が存在しない (${q.npcId})`);
    // **1 NPC 1 クエスト。** 複数あるとぶつかったときどれを話すのか決められない
    // (連続クエストは「達成で次が解放」の形で将来やる)。
    if (perNpc.has(q.npcId)) throw new QuestDataError(`${where}: NPC ${q.npcId} には既に「${perNpc.get(q.npcId)}」がある`);
    perNpc.set(q.npcId, q.title);
    for (const [name, lines] of [['intro', q.intro], ['done', q.done], ['progress', q.progress ?? ['たのんだよ。']]] as const) {
      if (!Array.isArray(lines) || lines.length === 0) throw new QuestDataError(`${where}: ${name} が空`);
      for (const l of lines) {
        if (typeof l !== 'string' || l.trim() === '' || l.length > MAX_QUEST_LINE) {
          throw new QuestDataError(`${where}: ${name} のセリフが不正`);
        }
      }
    }
    const o = q.objective;
    if (!o) throw new QuestDataError(`${where}: 達成条件が無い`);
    if (o.kind === 'defeat') {
      if (!MONSTERS_BY_ID[o.monsterId]) throw new QuestDataError(`${where}: モンスターが存在しない (${o.monsterId})`);
    } else if (o.kind === 'collect') {
      if (!ITEMS[o.itemId]) throw new QuestDataError(`${where}: アイテムが存在しない (${o.itemId})`);
    } else {
      throw new QuestDataError(`${where}: 達成条件の種類が不正`);
    }
    if (!Number.isInteger(o.count) || o.count < 1 || o.count > 99) throw new QuestDataError(`${where}: 個数は 1〜99`);
    if (q.requireFlags !== undefined) {
      if (!Array.isArray(q.requireFlags)) throw new QuestDataError(`${where}: requireFlags が配列でない`);
      for (const f of q.requireFlags) {
        // シナリオ側と同じ書式で弾く (#545)。大文字などの typo を通すと、
        // そのフラグは永久に立たず**誰も受注できないクエスト**が無言で生まれる。
        if (!isFlagName(f)) throw new QuestDataError(`${where}: 解禁フラグ名が不正 (${f})`);
      }
    }
    assertItemRequirements(q.requireItems, where, (id) => !!ITEMS[id]);
    if (q.reward) {
      if (q.reward.power !== undefined && !(Number.isInteger(q.reward.power) && q.reward.power > 0 && q.reward.power <= MAX_QUEST_REWARD_POWER)) {
        throw new QuestDataError(`${where}: 報酬パワーは 1〜${MAX_QUEST_REWARD_POWER}`);
      }
      if (q.reward.itemId !== undefined) {
        if (!ITEMS[q.reward.itemId]) throw new QuestDataError(`${where}: 報酬アイテムが存在しない (${q.reward.itemId})`);
        if (!(Number.isInteger(q.reward.count) && (q.reward.count ?? 0) > 0)) throw new QuestDataError(`${where}: 報酬アイテムの個数が不正`);
      }
    }
  }
  quests = next.map((q) => ({ ...q, intro: [...q.intro], done: [...q.done], ...(q.progress ? { progress: [...q.progress] } : {}), ...(q.requireFlags ? { requireFlags: [...q.requireFlags] } : {}), ...(q.requireItems ? { requireItems: q.requireItems.map((r) => ({ ...r })) } : {}) }));
  byId = new Map(quests.map((q) => [q.id, q]));
  byNpc = new Map(quests.map((q) => [q.npcId, q]));
}

export function gameQuests(): readonly GameQuestDef[] {
  return quests;
}

export function gameQuestById(id: string): GameQuestDef | undefined {
  return byId.get(id);
}

/** その NPC が発注しているクエスト (無ければ undefined = ただの会話)。 */
export function gameQuestByNpc(npcId: string): GameQuestDef | undefined {
  return byNpc.get(npcId);
}
