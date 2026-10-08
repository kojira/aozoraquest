/**
 * バトル状態の型と開始 (startBattle)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { type Archetype, type StatArray } from './types.js';
import { type GearSelection } from './equipment.js';
import { type CombatSides } from './combat-target.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng } from './battle-rng.js';
import { type JobSkill, skillForJob, skillsForJob, mpGainsFor, mpTraitChanceOf } from './battle-job-skills.js';
import { type Combatant, playerCombatant } from './battle-combatant.js';
import { type Tier, MONSTERS_BY_ID, summonMonster, monsterCombatant } from './battle-monsters.js';

// ─── バトル状態と解決 ───────────────────────────────────────

export type Command = 'attack' | 'guard' | 'skill' | 'herb' | 'tonic' | 'flee';

export type BattleOutcome = 'ongoing' | 'win' | 'lose' | 'fled' | 'monster-fled';

export interface TurnEvent {
  /** 誰の行動か */
  actor: 'player' | 'monster';
  /** 表示用テキスト (UI はこれを流すだけでよい) */
  text: string;
  /** ダメージ量 (被弾演出用)。回避/防御などで 0 のこともある */
  damage?: number;
  /** 対象が倒れたか */
  fatal?: boolean;
}

export interface BattleState {
  seed: number;
  turn: number;
  player: Combatant;
  monster: Combatant;
  monsterId: string;
  /** マルチ戦闘の味方陣 (player + 召喚 + NPC)。#453 / docs/25 §14.8。省略時はソロ = [player]。
   *  慣例として allies[0] === player (player 固有資源 herbs/tonics 等は BattleState 側に残す)。 */
  allies?: Combatant[];
  /** マルチ戦闘の敵陣 (モンスター群)。省略時はソロ = [monster]。慣例として enemies[0] === monster。 */
  enemies?: Combatant[];
  /** 署名スキル ([0])。後方互換 (parry 判定・autoBattle 等はこれ)。 */
  playerSkill: JobSkill;
  /** その jobLevel で使える全とくぎ ([0]=署名 + 習得済み副スキル)。UI は毎ターンここから選ぶ (#436)。 */
  playerSkills: JobSkill[];
  outcome: BattleOutcome;
  /** 残りやくそう (持ち込み分)。使うと減る。 */
  herbs: number;
  /** このバトルで使ったやくそう数 (記録用 → 在庫から差し引く)。 */
  herbsUsed: number;
  /** 残りそらのしずく (MP 回復薬)。 */
  tonics: number;
  /** このバトルで使ったそらのしずく数 (記録用 → 在庫から差し引く)。 */
  tonicsUsed: number;
  /** たたかう / ぼうぎょ の MP 回復量 (ジョブ特性 JOB_MP_TRAITS 込み。UI 表示用にも使う) */
  mpAttackGain: number;
  mpGuardGain: number;
  /** MP 特性名 (特性なしジョブは undefined) */
  mpTraitName?: string;
  /** MP 特性の発動確率 (0〜1)。undefined = 毎ターン確実 (従来どおり)。JOB_MP_TRAITS.chance を参照。 */
  mpTraitChance?: number;
  /** 直近ターンのイベント列 (UI 演出用。全履歴は保持しない = 状態を軽く保つ) */
  lastEvents: TurnEvent[];
}

/**
 * 戦闘の両陣営を取り出す (#453)。マルチ戦闘なら allies/enemies 配列、ソロ (未設定 or 旧 sealed
 * state) なら [player]/[monster] に退避する。ターゲット解決・行動順の単一窓口。
 */
export function combatSides(state: BattleState): CombatSides {
  return {
    allies: state.allies && state.allies.length > 0 ? state.allies : [state.player],
    enemies: state.enemies && state.enemies.length > 0 ? state.enemies : [state.monster],
  };
}

/** バトル開始状態を作る。herbs = 持ち込むやくそう数 (0〜herbCarryMax)。 */
export function startBattle(
  archetype: Archetype,
  jobLevel: number,
  playerLevel: number,
  displayName: string,
  tier: Tier,
  seed: number,
  herbs = 0,
  /** フィールドの現在 HP/MP を引き継いでバトルを始める (あおぞらワールドでは
   *  HP/MP が戦闘をまたいで持続する。docs/19)。未指定は全快で開始 (試練)。 */
  carry?: { hp?: number; mp?: number },
  extras?: {
    /** 持ち込むそらのしずく (MP 回復薬) 数 (0〜tonicCarryMax)。 */
    tonics?: number;
    /** プレイヤーの基底ステータス (プロフィールの rpgStats)。未指定はジョブ基準値。 */
    baseStats?: StatArray;
    /** 装備中の装備 id 列 (EQUIPMENT)。sim 用の簡易形 */
    equipIds?: readonly string[];
    /** 装備中の個体 (強化値つき)。アプリ本則 */
    gear?: GearSelection;
    /** 地域の相性 (regionAffinity)。指定するとその型のモンスターが出やすくなる。 */
    affinity?: number;
    /** 敵 HP/MP の分散 (±割合)。world 遭遇のみ指定、trial は未指定 = 0 (固定)。 */
    vitalsVariance?: number;
    /** 出現を tier 抽選せず**この id のモンスターに固定**する (模擬戦シミュレータ用)。
     *  未知 id は無視して従来どおり tier 抽選。 */
    monsterId?: string;
    /** 追加の敵数 (#453 マルチ戦闘: 群れ)。0=ソロ (従来・enemies 未設定)、1〜2 で計 2〜3 体。
     *  各追加敵は同 tier から別 seed で抽選し monsterId を保持。allies=[player]・enemies=[主敵, …追加] を設定。 */
    extraEnemies?: number;
  },
): BattleState {
  const player = playerCombatant(archetype, jobLevel, playerLevel, displayName, extras?.baseStats, extras?.equipIds, extras?.gear);
  if (carry?.hp !== undefined) {
    player.hp = Math.max(1, Math.min(player.maxHp, Math.floor(carry.hp)));
  }
  if (carry?.mp !== undefined) {
    player.mp = Math.max(0, Math.min(player.maxMp, Math.floor(carry.mp)));
  }
  const variance = extras?.vitalsVariance ?? 0;
  const forced = extras?.monsterId ? MONSTERS_BY_ID[extras.monsterId] : undefined;
  const { def, combatant } = forced
    ? { def: forced, combatant: monsterCombatant(forced, variance, createRng((seed ^ 0x2a9f) >>> 0)) }
    : summonMonster(tier, playerLevel, seed, jobLevel, extras?.affinity, variance);
  const gains = mpGainsFor(archetype);
  // #453 群れ: 追加の敵を別 seed で抽選 (最大 +2 = 計 3 体)。0 のとき enemies 未設定 = 従来ソロ。
  const extraCount = Math.max(0, Math.min(2, Math.floor(extras?.extraEnemies ?? 0)));
  const enemies: Combatant[] = [combatant];
  for (let i = 0; i < extraCount; i++) {
    const es = (seed ^ (0x9e3779b1 * (i + 1))) >>> 0;
    enemies.push(
      forced
        ? monsterCombatant(forced, variance, createRng((es ^ 0x2a9f) >>> 0))
        : summonMonster(tier, playerLevel, es, jobLevel, extras?.affinity, variance).combatant,
    );
  }
  return {
    seed,
    turn: 0,
    player,
    monster: combatant,
    monsterId: def.id,
    ...(extraCount > 0 ? { allies: [player], enemies } : {}),
    playerSkill: skillForJob(archetype),
    playerSkills: skillsForJob(archetype, jobLevel),
    outcome: 'ongoing',
    herbs: Math.max(0, Math.min(BATTLE_TUNING.herbCarryMax, Math.floor(herbs))),
    herbsUsed: 0,
    tonics: Math.max(0, Math.min(BATTLE_TUNING.tonicCarryMax, Math.floor(extras?.tonics ?? 0))),
    tonicsUsed: 0,
    mpAttackGain: gains.attackGain,
    mpGuardGain: gains.guardGain,
    ...(gains.traitName ? { mpTraitName: gains.traitName } : {}),
    ...(gains.chance !== undefined ? { mpTraitChance: mpTraitChanceOf(gains.chance, player.luk)! } : {}),
    lastEvents: [],
  };
}
