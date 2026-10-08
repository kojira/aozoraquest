/**
 * マルチ戦闘のターン解決 (resolveTurnMulti)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { SKILLS, runSkillMulti } from './skills.js';
import { resolveTargets, type CombatSides } from './combat-target.js';
import { STATUS_REGISTRY, applyBeforeAct, tickStatuses } from './statuses.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { createRng, turnRng } from './battle-rng.js';
import { skillMpCostOf, mpTraitFires } from './battle-job-skills.js';
import { type Combatant } from './battle-combatant.js';
import { MONSTERS_BY_ID } from './battle-monsters.js';
import { type Command, type TurnEvent, type BattleState, combatSides } from './battle-state.js';
import { doAttack, doMagic } from './battle-attack.js';
import { monsterCommand } from './battle-monster-ai.js';

/** Combatant を 1 ターン分コピー (guarding リセット・statuses は deep copy)。 */
function copyCombatant(c: Combatant): Combatant {
  return { ...c, guarding: false, ...(c.statuses ? { statuses: c.statuses.map((s) => ({ ...s })) } : {}) };
}

/** 生存者からランダムに 1 体 (全滅なら undefined)。 */
function randomLiving(arr: readonly Combatant[], rng: () => number): Combatant | undefined {
  const living = arr.filter((c) => c.hp > 0);
  return living.length ? living[Math.floor(rng() * living.length)] : undefined;
}

/** マルチ戦闘での敵1体の行動 (#453)。1v1 の monster act と同じ ability (charger/healer/caster) を、
 *  敵個体の monsterId で引いて実行する。ターゲットはランダムな生存味方 (挑発/かばうは後続)。
 *  flee は集団戦では意味が薄いので通常攻撃に退避する。 */
function multiEnemyAct(enemy: Combatant, allies: Combatant[], state: BattleState, rng: () => number, events: TurnEvent[]): void {
  const t = BATTLE_TUNING;
  const def = MONSTERS_BY_ID[enemy.monsterId ?? state.monsterId];
  // ため中なら宣言どおり強攻撃を解放 (mCommand は無視)。
  if (enemy.charging) {
    enemy.charging = false;
    const target = randomLiving(allies, rng);
    if (target) doAttack(enemy, target, rng, events, 'monster', { power: t.chargedPower, hitBonus: -0.05, label: def?.skillName ?? 'つよいこうげき' });
    return;
  }
  const action = monsterCommand(enemy, state, rng);
  if (action === 'guard') {
    enemy.guarding = true; // 被ダメ軽減の宣言 (turn 頭で全体リセット済み)
    return;
  }
  if (action === 'charge') {
    enemy.mp = Math.max(0, enemy.mp - t.monsterChargeMpCost);
    enemy.charging = true;
    events.push({ actor: 'monster', text: `${enemy.name}は力をためている…!` });
    return;
  }
  if (action === 'heal') {
    enemy.mp = Math.max(0, enemy.mp - t.monsterHealMpCost);
    const healed = Math.round(enemy.maxHp * t.healerHealRatio);
    const before = enemy.hp;
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
    events.push({ actor: 'monster', text: `${enemy.name}は${def?.healName ?? 'きずをいやす'}! HP が ${enemy.hp - before} 回復。` });
    return;
  }
  if (action === 'cast' && def?.spell) {
    enemy.mp = Math.max(0, enemy.mp - t.monsterCastMpCost);
    const spell = def.spell;
    const span = spell.max - spell.min;
    const amount = spell.min + Math.floor(rng() * (span + 1)) + Math.round(enemy.int * (spell.intScale ?? 0));
    const target = randomLiving(allies, rng);
    if (target) doMagic(enemy, target, rng, events, 'monster', { amount, ...(spell.element ? { element: spell.element } : {}), label: spell.name });
    return;
  }
  // attack / flee (集団戦は通常攻撃に退避) / spell 未定義の cast。
  const target = randomLiving(allies, rng);
  if (target) doAttack(enemy, target, rng, events, 'monster');
}

/**
 * マルチ戦闘のターン解決 (#453 / docs/25 §14.8)。**allies[] vs enemies[]** を全員 agi+乱数で
 * 並べ、順に行動させる。ソロ用 resolveTurn とは**別経路** (1v1 は一切変更しない)。
 *
 * 現ブロックの AI: プレイヤーは command + skillIndex + targetIndex、召喚/NPC 味方はランダムな敵へ
 * 通常攻撃、敵は個体ごとの ability (charger/healer/caster) でランダムな味方へ行動 (#453。挑発/かばう・
 * 味方 autoBattle は後続)。
 */
export function resolveTurnMulti(
  prev: BattleState,
  command: Command,
  turnSeed?: number,
  skillIndex = 0,
  targetIndex = 0,
): BattleState {
  if (prev.outcome !== 'ongoing') return prev;
  const t = BATTLE_TUNING;
  // combatSides を単一窓口に (ソロ退避のロジックを二重実装しない)。各体は 1 ターン分 deep copy。
  const prevSides = combatSides(prev);
  const allies = prevSides.allies.map(copyCombatant);
  const enemies = prevSides.enemies.map(copyCombatant);
  const state: BattleState = { ...prev, turn: prev.turn + 1, allies, enemies, player: allies[0]!, monster: enemies[0]!, lastEvents: [] };
  const sides: CombatSides = { allies, enemies };
  const player = allies[0]!;
  // ぼうぎょは 1 ターン限り: copyCombatant が guarding:false でコピーするので、このターンの宣言/AI で立て直す。
  const isAlly = (c: Combatant) => allies.includes(c);
  const events: TurnEvent[] = [];
  const rng = turnSeed === undefined ? turnRng(state.seed, state.turn) : createRng(turnSeed >>> 0);

  const skills = state.playerSkills ?? [state.playerSkill];
  const selectedSkill = skills[skillIndex] ?? skills[0] ?? state.playerSkill;

  // ── コマンド実効化 (ソロと同じ防御的措置) ──
  let cmd: Command = command;
  const skillCost = skillMpCostOf(player); // 発明家/巫女の MP 割引を反映
  if (command === 'skill' && player.mp < skillCost) {
    events.push({ actor: 'player', text: `MP が足りない! (${player.mp}/${skillCost})` });
    cmd = 'attack';
  } else if (command === 'herb' && state.herbs <= 0) {
    events.push({ actor: 'player', text: 'やくそうを持っていない!' });
    cmd = 'attack';
  } else if (command === 'tonic' && state.tonics <= 0) {
    events.push({ actor: 'player', text: 'そらのしずくを持っていない!' });
    cmd = 'attack';
  }
  if (cmd === 'skill') player.mp -= skillCost;

  // 防御宣言 (行動順に依存しない)
  if (cmd === 'guard') {
    player.guarding = true;
    player.focus = 2;
    if (state.mpGuardGain > 0 && mpTraitFires(state.mpTraitChance, rng)) {
      player.mp = Math.min(player.maxMp, player.mp + state.mpGuardGain);
      events.push({ actor: 'player', text: `${player.name}はぼうぎょして息を整えた。(MP +${state.mpGuardGain})` });
    } else {
      events.push({ actor: 'player', text: `${player.name}はぼうぎょのかまえ!` });
    }
  }
  if (cmd === 'skill' && SKILLS[selectedSkill.kind]?.parry) {
    player.parrying = true;
    events.push({ actor: 'player', text: `${player.name}は${selectedSkill.name}の構え! (防御しつつ反撃)` });
  }

  // にげる (味方全員で離脱)
  if (cmd === 'flee') {
    const fastestFoe = Math.max(...enemies.filter((e) => e.hp > 0).map((e) => e.agi), 0);
    const chance = Math.min(t.fleeMax, Math.max(t.fleeMin, t.fleeBase + (player.agi - fastestFoe) * t.fleeAgiScale));
    if (rng() < chance) {
      state.outcome = 'fled';
      events.push({ actor: 'player', text: `${player.name}たちはうまく逃げ切った!` });
      state.lastEvents = events;
      return state;
    }
    events.push({ actor: 'player', text: 'にげられない! 回り込まれてしまった!' });
  }

  // 行動順: 全参加者を agi + 乱数で並べる (playerFirst 撤廃)
  const order = [...allies, ...enemies]
    .filter((c) => c.hp > 0)
    .map((c) => ({ c, roll: c.agi + rng() * 20 }))
    .sort((a, b) => b.roll - a.roll)
    .map((x) => x.c);

  const alliesDown = () => allies.every((a) => a.hp <= 0);
  const enemiesDown = () => enemies.every((e) => e.hp <= 0);

  for (const actor of order) {
    if (state.outcome !== 'ongoing' || alliesDown() || enemiesDown()) break;
    if (actor.hp <= 0) continue; // このターン中に倒された
    const side: 'player' | 'monster' = isAlly(actor) ? 'player' : 'monster';
    if (applyBeforeAct(actor, { rng, events, actor: side })) continue; // 行動不能
    const consumed = (actor.statuses ?? []).filter((s) => STATUS_REGISTRY[s.id]?.clearOnAct);

    if (actor === player) {
      if (cmd === 'attack') {
        const target = resolveTargets(player, 'oneEnemy', sides, { targetIndex })[0];
        if (target) {
          doAttack(player, target, rng, events, 'player');
          if (state.mpAttackGain > 0 && mpTraitFires(state.mpTraitChance, rng)) player.mp = Math.min(player.maxMp, player.mp + state.mpAttackGain);
        }
      } else if (cmd === 'skill') {
        const def = SKILLS[selectedSkill.kind];
        if (def) {
          runSkillMulti(
            def,
            player,
            sides,
            (defender) => ({ attacker: player, defender, rng, events, skillName: selectedSkill.name, actorSide: 'player', engine: { doAttack, doMagic } }),
            { targetIndex, label: selectedSkill.name, events, actor: 'player' },
          );
        }
      } else if (cmd === 'herb') {
        const heal = Math.round(player.maxHp * t.herbHealRatio);
        player.hp = Math.min(player.maxHp, player.hp + heal);
        state.herbs -= 1;
        state.herbsUsed += 1;
        events.push({ actor: 'player', text: `${player.name}はやくそうを使った! HP が ${heal} 回復。(残り ${state.herbs})` });
      } else if (cmd === 'tonic') {
        const gain = Math.round(player.maxMp * t.tonicMpRatio);
        player.mp = Math.min(player.maxMp, player.mp + gain);
        state.tonics -= 1;
        state.tonicsUsed += 1;
        events.push({ actor: 'player', text: `${player.name}はそらのしずくを飲んだ! MP が ${gain} 回復。(残り ${state.tonics})` });
      }
      // guard / flee 失敗はこのターン行動なし
    } else if (isAlly(actor)) {
      // 召喚/NPC 味方: ランダムな敵へ通常攻撃 (味方版 autoBattle は後続で拡張)
      const target = randomLiving(enemies, rng);
      if (target) doAttack(actor, target, rng, events, 'player');
    } else {
      // 敵: 個体ごとの ability (charger/healer/caster) で行動 (#453)。
      multiEnemyAct(actor, allies, state, rng, events);
    }

    if (consumed.length && actor.statuses) actor.statuses = actor.statuses.filter((s) => !consumed.includes(s));
  }

  // ターン終了処理 (毒等)
  if (state.outcome === 'ongoing') {
    for (const c of [...allies, ...enemies]) {
      tickStatuses(c, { rng, events, actor: isAlly(c) ? 'player' : 'monster' });
    }
  }
  // 見切り/余韻の後始末
  for (const c of [...allies, ...enemies]) c.parrying = false;
  player.focus = Math.max(0, player.focus - 1);

  // 勝敗判定
  if (state.outcome !== 'ongoing') {
    /* fled 等: 確定済み */
  } else if (enemiesDown()) {
    state.outcome = 'win';
  } else if (alliesDown()) {
    state.outcome = 'lose';
  }

  state.player = allies[0]!;
  state.monster = enemies[0]!;
  state.lastEvents = events;
  return state;
}
