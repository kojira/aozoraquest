/**
 * ブルスコンの試練 — バトルエンジン (docs/18-brusukon-trial.md)。
 *
 * ブルスコンが召喚した試練モンスターと 1 対 1 のターン制バトルを行う。
 * 1 戦 = あおぞらパワー 1 消費 (消費の記帳は web 側 points.ts / battle-log)。
 *
 * 設計方針:
 * - **決定的**: seed + コマンド列から結果が一意に決まる純関数エンジン。
 *   同じ seed で再生すれば同じ展開になる (テスト可能・記録の再現可能)。
 *   乱数はターン毎に hash(seed, turn) から作るので、state は JSON 化できる。
 * - **ジョブが戦い方に出る**: プレイヤーの戦闘値はジョブの 5 ステータス
 *   [atk, def, agi, int, luk] とレベルから導出。特技はジョブの支配ステータスで
 *   決まり (力型=強撃 / 守型=見切り / 速型=連撃 / 知型=魔撃 / 運型=大博打)、
 *   技名はジョブ固有。
 * - バランス値は本ファイルに集約 (BATTLE_TUNING)。
 */


export {
  BATTLE_TUNING,
} from './battle-tuning.js';
export {
  createRng,
  turnRng,
} from './battle-rng.js';
export {
  type SkillKind,
  JOB_SKILL_NAMES,
  type JobSkill,
  skillForJob,
  skillsForJob,
  jobPassives,
  skillMpCostOf,
  type MpTrait,
  JOB_MP_TRAITS,
  mpGainsFor,
  mpTraitChanceOf,
  SKILL_KIND_LABELS,
  skillKindLabel,
} from './battle-job-skills.js';
export {
  type Combatant,
  playerCombatant,
  type CombatStatsRaw,
  playerStatsAt,
  STAT_GAIN_MIN_DISPLAY,
  type StatGain,
  levelUpGains,
} from './battle-combatant.js';
export {
  type MonsterSpecies,
  type DropDef,
  type Tier,
  DEMON_CASTLE_REGIONS,
  type MonsterDef,
  ITEMS,
  MONSTERS,
  MONSTERS_BY_ID,
  MAX_POPULATED_TIER,
  recomputeMaxPopulatedTier,
  baselineXp,
  battleXpFor,
  pickTrialTier,
  TIER_LEVEL,
  favoredMonsterFor,
  summonMonster,
  monsterCombatant,
} from './battle-monsters.js';
export {
  type Command,
  type BattleOutcome,
  type TurnEvent,
  type BattleState,
  combatSides,
  startBattle,
} from './battle-state.js';
export {
  type AttackOptions,
  type AttackResult,
} from './battle-attack.js';
export {
  resolveTurn,
} from './battle-turn.js';
export {
  resolveTurnMulti,
} from './battle-turn-multi.js';
export {
  autoBattleAction,
  runAutoBattle,
} from './battle-auto.js';
export {
  rollDefeatLoss,
  rollDrops,
  SEARCH_TUNING,
  rollSearch,
  type BattleRecordSummary,
  type TitleDef,
  TITLES,
  earnedTitles,
} from './battle-rewards.js';
