/**
 * とくぎのプラグイン基盤 (戦闘刷新 #452 / docs/25 §2)。
 *
 * とくぎを **SkillDef = 効果プリミティブ (SkillEffect) の配列** として *データ* で表現し、
 * 各プリミティブを `EFFECT_HANDLERS` レジストリで実行する。`switch (skill.kind)` の
 * ベタ書き分岐を廃し、新しいとくぎは **SKILLS に 1 エントリ足すだけ** で追加できる
 * (オーナー要望: 「ベタ書き if 文で分岐せずプラグインのように記述できる綺麗なソース」)。
 *
 * エンジンの一次関数 (doAttack 等) は循環 import を避けるため **ctx.engine 経由で注入**する
 * (battle.ts が SKILLS/runSkill を import する値依存 ⇔ skills.ts は battle.ts の *型* だけ import)。
 */

import type { Combatant, TurnEvent, AttackOptions, AttackResult } from './battle.js';
import { applyStatus, DEFAULT_STATUS_TURNS, type StatusId } from './statuses.js';
import type { Element } from './elements.js';

/** ダメージの基準にする支配ステータス。int は魔撃 (必中・防御半減)、agi/luk は物理。 */
export type DamageStat = 'atk' | 'int' | 'agi' | 'luk';

/** ギャンブル倍率 (0〜max、luk が高いほど下振れしにくい)。 */
export interface GambleSpec {
  /** 倍率の上限 */
  max: number;
  /** 下限 = min(lukFloorCap, luk × lukFloorScale) */
  lukFloorScale: number;
  lukFloorCap: number;
}

/** 命中時に状態異常を付与する指定 (毒手など)。 */
export interface InflictSpec {
  status: StatusId;
  /** 付与確率 (0〜1、未指定=1)。 */
  chance?: number;
  /** 持続ターン (未指定=2)。 */
  turns?: number;
  /** 効果量 (毒ダメージ/バフ倍率)。省略時は状態のデフォルト。 */
  magnitude?: number;
}

/** とくぎの効果プリミティブ。ここに種類を足す = 新しい効果の語彙が増える。 */
export type SkillEffect =
  | {
      kind: 'damage';
      /** 攻撃力の基準ステータス */
      stat: DamageStat;
      /** ダメージ倍率 (gamble 指定時は無視して抽選) */
      power?: number;
      /** 連撃回数 (未指定=1)。対象が倒れたら以降の追撃は撃たない */
      hits?: number;
      /** 命中補正 (負で外れやすく) */
      hitBonus?: number;
      /** 防御係数 (魔撃=0.5 で貫通気味) */
      defFactor?: number;
      /** 指定すると power を luk 依存で抽選 (運ジョブ) */
      gamble?: GambleSpec;
      /** 命中した攻撃に状態異常を乗せる (毒手など)。miss/即死には乗らない。 */
      inflict?: InflictSpec;
      /** 攻撃属性 (火遁=fire 等)。防御側の element と相性判定。未指定は無属性 (等倍)。 */
      element?: Element;
    }
  | {
      kind: 'fixedDamage';
      /** ダメージの下限・上限 (DQ 流の範囲魔法。例 15〜20)。 */
      min: number;
      max: number;
      /** int 連動ボーナス: +attacker.int × intBonus (キャスターの int を伸ばす意味を出す)。 */
      intBonus?: number;
      /** 攻撃属性 (火水地風空)。防御側の element と相性判定。未指定は無属性 (等倍)。 */
      element?: Element;
    }
  | {
      kind: 'heal';
      /** maxHp に対する回復割合 */
      ratio: number;
    }
  | {
      kind: 'status';
      /** 付与する状態異常 */
      status: StatusId;
      /** self=使用者に (バフ/かくれみ/九字切り)、enemy=相手に (デバフ/毒/眠り) */
      target: 'self' | 'enemy';
      chance?: number;
      turns?: number;
      magnitude?: number;
    };

export interface SkillDef {
  /** とくぎ ID (JobSkill.kind と一致させる) */
  id: string;
  effects: SkillEffect[];
}

/** ハンドラに注入するエンジン一次関数 (循環 import 回避のための依存注入)。 */
export interface SkillEngine {
  /** 物理攻撃 (回避・会心・def 減算・反撃あり)。 */
  doAttack: (
    attacker: Combatant,
    defender: Combatant,
    rng: () => number,
    events: TurnEvent[],
    actor: 'player' | 'monster',
    opts?: AttackOptions,
  ) => AttackResult;
  /** 魔法ダメージ (範囲ベース・必中・def 無視)。amount は算出済みの生ダメージ。 */
  doMagic: (
    attacker: Combatant,
    defender: Combatant,
    rng: () => number,
    events: TurnEvent[],
    actor: 'player' | 'monster',
    opts: { amount: number; element?: Element; label?: string },
  ) => AttackResult;
}

/** 効果を解決するための文脈 (誰が誰に、どの乱数で)。 */
export interface SkillContext {
  attacker: Combatant;
  defender: Combatant;
  rng: () => number;
  events: TurnEvent[];
  /** テキストに使うとくぎ名 */
  skillName: string;
  engine: SkillEngine;
  /** 使用者の陣営 (#453 マルチ戦闘で敵もとくぎを撃つ時に使う。未指定は 'player')。
   *  今は単体戦闘なので常に 'player' 相当だが、doAttack へ渡す actor を将来書き換えずに済ませる。 */
  actorSide?: 'player' | 'monster';
}

type EffectHandler = (effect: SkillEffect, ctx: SkillContext) => void;

/** damage: 支配ステータス基準で doAttack を hits 回。int は魔撃 (必中)。 */
const damageHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'damage') return;
  const { attacker, defender, rng, events, engine, skillName } = ctx;
  const actor = ctx.actorSide ?? 'player';
  const hits = effect.hits ?? 1;
  for (let i = 0; i < hits; i++) {
    // 対象が倒れていたら以降の追撃は無駄撃ちしない (flurry の 2 撃目 = 従来挙動)。
    if (defender.hp <= 0) break;
    const opts: AttackOptions = { label: skillName, power: effect.power ?? 1 };
    if (effect.hitBonus !== undefined) opts.hitBonus = effect.hitBonus;
    if (effect.defFactor !== undefined) opts.defFactor = effect.defFactor;
    if (effect.element !== undefined) opts.element = effect.element;
    switch (effect.stat) {
      case 'atk':
        break; // 素の atk (default)
      case 'int':
        opts.useInt = true; // 魔撃: int 基準・必中
        break;
      case 'agi':
        opts.atkOverride = attacker.agi;
        break;
      case 'luk':
        opts.atkOverride = attacker.luk;
        break;
    }
    if (effect.gamble) {
      const g = effect.gamble;
      const floor = Math.min(g.lukFloorCap, attacker.luk * g.lukFloorScale);
      opts.power = floor + rng() * (g.max - floor);
    }
    const res = engine.doAttack(attacker, defender, rng, events, actor, opts);
    // 命中した攻撃にだけ状態異常を乗せる (miss/即死には乗らない)。
    if (effect.inflict && res.hit && !res.fatal) {
      const inf = effect.inflict;
      if (rng() < (inf.chance ?? 1)) {
        applyStatus(defender, {
          id: inf.status,
          turns: inf.turns ?? DEFAULT_STATUS_TURNS,
          ...(inf.magnitude !== undefined ? { magnitude: inf.magnitude } : {}),
        });
      }
    }
  }
};

/** status: 使用者 (self) or 相手 (enemy) に状態異常を付与 (バフ/デバフ/かくれみ)。 */
const statusHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'status') return;
  const { attacker, defender, rng } = ctx;
  if (rng() >= (effect.chance ?? 1)) return;
  const target = effect.target === 'self' ? attacker : defender;
  applyStatus(target, {
    id: effect.status,
    turns: effect.turns ?? DEFAULT_STATUS_TURNS,
    ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}),
  });
};

/** fixedDamage: 範囲ロール + int 連動 → doMagic (必中・def無視・属性相性)。DQ 流の魔法。 */
const fixedDamageHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'fixedDamage') return;
  const { attacker, defender, rng, events, engine, skillName } = ctx;
  const actor = ctx.actorSide ?? 'player';
  if (defender.hp <= 0) return;
  const span = effect.max - effect.min;
  let amount = effect.min + Math.floor(rng() * (span + 1));
  if (effect.intBonus) amount += attacker.int * effect.intBonus;
  engine.doMagic(attacker, defender, rng, events, actor, {
    amount,
    ...(effect.element ? { element: effect.element } : {}),
    label: skillName,
  });
};

/** heal: maxHp の割合ぶん回復 (攻撃しないターン)。 */
const healHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'heal') return;
  const { attacker, events, skillName } = ctx;
  const heal = Math.round(attacker.maxHp * effect.ratio);
  attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
  events.push({ actor: 'player', text: `${attacker.name}は${skillName}! HP が ${heal} 回復。` });
};

/** 効果種別 → ハンドラ。ここに 1 行足す = 新しい効果プリミティブが使えるようになる。 */
export const EFFECT_HANDLERS: Record<SkillEffect['kind'], EffectHandler> = {
  damage: damageHandler,
  fixedDamage: fixedDamageHandler,
  heal: healHandler,
  status: statusHandler,
};

/**
 * とくぎ定義レジストリ (id → SkillDef)。既存 6 種を移行 (挙動は従来と同一)。
 * 新しいとくぎは **ここに 1 エントリ追加するだけ**。
 */
export const SKILLS: Record<string, SkillDef> = {
  // 強打: atk 基準 1.7 倍・やや当てにくい
  smash: { id: 'smash', effects: [{ kind: 'damage', stat: 'atk', power: 1.7, hitBonus: -0.1 }] },
  // 見切り: 宣言は resolveTurn 冒頭 (行動順に依存しない)。ここでは効果なし。
  parry: { id: 'parry', effects: [] },
  // 連撃: agi 基準 0.65 倍 × 2 撃 (素早さで手数)
  flurry: { id: 'flurry', effects: [{ kind: 'damage', stat: 'agi', power: 0.65, hits: 2 }] },
  // 魔撃: int 基準・必中・防御半減
  spell: { id: 'spell', effects: [{ kind: 'damage', stat: 'int', power: 1.0, defFactor: 0.5 }] },
  // 一か八か: luk 基準・0〜2.6 倍抽選 (luk で下振れ緩和)
  gamble: {
    id: 'gamble',
    effects: [{ kind: 'damage', stat: 'luk', gamble: { max: 2.6, lukFloorScale: 0.012, lukFloorCap: 0.6 } }],
  },
  // 回復 (#436): maxHp の 0.35 (= 旧 BATTLE_TUNING.skillHealRatio を移行)
  heal: { id: 'heal', effects: [{ kind: 'heal', ratio: 0.35 }] },
};

/** SkillDef の全効果を順に解決する (プラグイン実行のエントリポイント)。 */
export function runSkill(def: SkillDef, ctx: SkillContext): void {
  for (const effect of def.effects) {
    EFFECT_HANDLERS[effect.kind](effect, ctx);
  }
}
