/**
 * **シナリオの進行判定** (#545)。フラグを立てるのは edge だけ。
 *
 * client の自己申告でフラグが立つと、クエストの解禁も NPC の分岐も破られる
 * (「章 3 のフラグ」を POST すれば終盤のクエストが受け放題になる)。条件の判定も
 * 付与もここでやり、client は結果を受け取るだけにする。
 *
 * 呼ぶのは**進行が動く経路** (クエスト達成・戦闘決着) の後。毎移動では見ない —
 * 条件が満たされるのはこの 2 つの後だけで、歩くたびに PDS を読むのは高すぎる。
 */
import { jobLevelFromXp, pendingScenario, type ScenarioEvent } from '@aozoraquest/core';
import type { GameState } from './game-state';

/** 立てたフラグと、一度だけ出すお知らせ。 */
export interface ScenarioResult {
  flags: string[];
  notices: string[];
  fired: string[];
}

/**
 * その state で新しく発火するイベントを解決する。**state は書き換えない** (純関数) —
 * readModifyWrite の mutate から呼ぶので、リトライで複数回走っても同じ結果になる必要がある。
 */
export function advanceScenario(state: GameState): ScenarioResult | null {
  const jobXpLevels: Record<string, number> = {};
  for (const [job, xp] of Object.entries(state.jobXp ?? {})) jobXpLevels[job] = jobLevelFromXp(xp, job);
  const { fired, flags } = pendingScenario({
    flags: state.flags ?? [],
    questsDone: state.questsDone ?? [],
    jobXpLevels,
    materials: state.materials ?? {},
  });
  if (fired.length === 0) return null;
  return {
    flags,
    notices: fired.map((e: ScenarioEvent) => e.notice).filter((n): n is string => !!n),
    fired: fired.map((e: ScenarioEvent) => e.id),
  };
}
