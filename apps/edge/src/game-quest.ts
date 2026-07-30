/**
 * **ゲーム内クエストの受注・達成** (#423)。進行と報酬はここ (edge) が権威。
 *
 * - 受注: 進行中が無ければ `GameState.quest` に積む。達成済みは再受注できない
 * - 達成: 条件を**権威データで検証**してから報酬を付与する
 *   - defeat: 勝利時に数えた討伐数 (battle-reward が増やす)
 *   - collect: 権威在庫の所持数。達成時に**引き取る** (渡すのが DQ の作法で、
 *     引かないと同じ素材で何度も達成できてしまう)
 * - 報酬のパワーは定義の値だけ。client は金額を送らない (サーバー権威)
 */
import { gameQuestById, MAX_QUEST_REWARD_POWER } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type GameStateEnv } from './game-state';
import { advanceScenario, type ScenarioResult } from './scenario-progress';

export class GameQuestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const MAX_DONE = 200;

export interface QuestStateResult {
  quest?: { id: string; progress: number };
  questsDone?: string[];
  power: number;
  materials: Record<string, number>;
  /** 達成時のみ: 付与した報酬。 */
  rewarded?: { power?: number; itemId?: string; count?: number };
  /** 進行フラグ (#545)。達成でシナリオが進むと増える。 */
  flags?: string[];
  /** シナリオのお知らせ (「東の橋が直ったらしい」)。一度だけ出す。 */
  notices?: string[];
}

export async function handleQuestAccept(
  env: GameStateEnv,
  did: string,
  questId: string,
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<QuestStateResult> {
  const def = gameQuestById(questId);
  if (!def) throw new GameQuestError('そのクエストは無い', 404, 'unknown_quest');
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if ((cur.questsDone ?? []).includes(questId)) throw new GameQuestError('もう達成している', 400, 'already_done');
      // **解禁フラグ** (#545)。立っていないクエストはサーバーが受け付けない
      // (client が NPC の分岐を無視して直接 POST しても通らない)。
      const need = def.requireFlags ?? [];
      if (need.some((f) => !(cur.flags ?? []).includes(f))) {
        throw new GameQuestError('まだ その たのまれごとは 出ていない', 400, 'locked');
      }
      if (cur.quest?.id === questId) return cur; // 再受注は no-op (連打・再送で壊れない)
      // **1 つずつ。** 同時進行を許すと「どの敵を数えるか」が曖昧になる (将来 quests[] 化も可能)。
      // ただし定義が消された孤児クエスト (管理者がエディタで削除) は無かったことにする —
      // 破棄手段が無いので、残すとそのプレイヤーは永久に何も受けられなくなる (UX レビュー ★★★)。
      if (cur.quest && gameQuestById(cur.quest.id)) throw new GameQuestError('別のたのまれごとを うけている', 400, 'quest_busy');
      return { ...cur, quest: { id: questId, progress: 0 } };
    },
    init ? { now, init } : { now },
  );
  return { quest: next.quest, questsDone: next.questsDone, power: next.power, materials: next.materials, ...(next.flags ? { flags: next.flags } : {}) };
}

export async function handleQuestComplete(
  env: GameStateEnv,
  did: string,
  questId: string,
  now: number,
  init?: (did: string, nowIso: string) => Promise<GameState>,
): Promise<QuestStateResult> {
  const def = gameQuestById(questId);
  if (!def) throw new GameQuestError('そのクエストは無い', 404, 'unknown_quest');
  // 報酬の再検証 (定義レコードが壊れても暴走しない最後の砦)
  const rewardPower = Math.min(def.reward?.power ?? 0, MAX_QUEST_REWARD_POWER);
  let rewarded: QuestStateResult['rewarded'];
  const scenarioBox: { v: ScenarioResult | null } = { v: null };
  const next = await readModifyWrite(
    env,
    did,
    (cur) => {
      if ((cur.questsDone ?? []).includes(questId)) throw new GameQuestError('もう達成している', 400, 'already_done');
      if (cur.quest?.id !== questId) throw new GameQuestError('うけていない', 400, 'not_accepted');

      let materials = cur.materials;
      const o = def.objective;
      if (o.kind === 'defeat') {
        if ((cur.quest.progress ?? 0) < o.count) {
          throw new GameQuestError(`まだ ${cur.quest.progress ?? 0}/${o.count} たい`, 400, 'not_ready');
        }
      } else {
        const have = cur.materials[o.itemId] ?? 0;
        if (have < o.count) throw new GameQuestError(`まだ ${have}/${o.count} こ`, 400, 'not_ready');
        // **引き取る** — 引かないと同じ素材で何度も達成できる (別クエストや将来の複数進行で)。
        materials = { ...cur.materials };
        const left = have - o.count;
        if (left > 0) materials[o.itemId] = left;
        else delete materials[o.itemId];
      }

      if (def.reward?.itemId) {
        materials = { ...materials };
        materials[def.reward.itemId] = (materials[def.reward.itemId] ?? 0) + (def.reward.count ?? 0);
      }
      rewarded = {
        ...(rewardPower > 0 ? { power: rewardPower } : {}),
        ...(def.reward?.itemId ? { itemId: def.reward.itemId, count: def.reward.count ?? 0 } : {}),
      };
      const done: GameState = {
        ...cur,
        quest: undefined,
        questsDone: [...(cur.questsDone ?? []), questId].slice(-MAX_DONE),
        power: cur.power + rewardPower,
        materials,
      };
      // 達成はシナリオが動く主な経路 (#545)。フラグと お知らせ をここで確定する。
      // mutate は純関数なので、リトライで複数回走っても同じ結果になる。
      scenarioBox.v = advanceScenario(done);
      return scenarioBox.v ? { ...done, flags: scenarioBox.v.flags } : done;
    },
    init ? { now, init } : { now },
  );
  return {
    quest: next.quest, questsDone: next.questsDone, power: next.power, materials: next.materials,
    ...(rewarded ? { rewarded } : {}),
    ...(next.flags ? { flags: next.flags } : {}),
    ...(scenarioBox.v?.notices.length ? { notices: scenarioBox.v.notices } : {}),
  };
}
