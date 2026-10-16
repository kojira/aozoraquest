/**
 * **テスト用のふたばの村の村人・依頼・シナリオ** (D-DIALOGUE-006 §6)。ゲームコードは村人や
 * セリフを持たず、正は管理者 PDS の world.* レコードだけ。ここは撤去前の同梱データを
 * そのまま JSON にした決定的なテストの入力 (`fixtures/starter-town.json`)。
 * **index から export しない** (配布コードに入れない)。呼ぶたびに複製を返す。
 */
import { readFileSync } from 'node:fs';
import type { NpcDef } from '../../npc-data.js';
import type { GameQuestDef } from '../../quest-data.js';
import type { ScenarioEvent } from '../../scenario.js';

type StarterTownFixture = { npcs: NpcDef[]; quests: GameQuestDef[]; scenario: ScenarioEvent[]; sampleScenario: ScenarioEvent[] };

function load(): StarterTownFixture {
  return JSON.parse(readFileSync(new URL('../fixtures/starter-town.json', import.meta.url), 'utf8')) as StarterTownFixture;
}

export function starterTownNpcs(): NpcDef[] { return load().npcs; }
export function starterTownQuests(): GameQuestDef[] { return load().quests; }
export function starterTownScenario(): ScenarioEvent[] { return load().scenario; }
/** 3 つが順に繋がるシナリオのサンプル (sample-1..3)。 */
export function sampleScenario(): ScenarioEvent[] { return load().sampleScenario; }
