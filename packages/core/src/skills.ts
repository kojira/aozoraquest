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
import {
  applyStatus,
  statusApplyText,
  applyStatusDurationBonus,
  DEFAULT_STATUS_TURNS,
  AILMENT_IDS,
  type StatusId,
  type HookCtx,
} from './statuses.js';
import type { Element } from './elements.js';
import { resolveTargets, type SkillTarget, type CombatSides } from './combat-target.js';

/** ダメージの基準にする支配ステータス。int は魔撃 (必中・防御半減)、agi/luk は物理。 */
export type DamageStat = 'atk' | 'int' | 'agi' | 'luk' | 'def';

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
      /** 対象 (マルチ戦闘 #453)。未指定は oneEnemy。allEnemies で全体物理 (なぎ払い等)。 */
      target?: SkillTarget;
      /** 計算値参照 (§14.5)。'missingHpRatio' = 使用者の失った HP 割合 (背水の陣: HP 低いほど威力↑)。 */
      scaleBy?: 'missingHpRatio';
      /** scaleBy の倍率: power ×= 1 + value × scaleFactor。未指定 1.0。 */
      scaleFactor?: number;
    }
  | {
      kind: 'fixedDamage';
      /** ダメージの下限・上限 (DQ 流の範囲魔法。例 15〜20)。 */
      min: number;
      max: number;
      /** int 連動ボーナス: +attacker.int × intBonus (int キャスター)。 */
      intBonus?: number;
      /** luk 連動ボーナス: +attacker.luk × luckScale (luk 型魔法: 巫女/芸術家/詩人。§423)。 */
      luckScale?: number;
      /** 攻撃属性 (火水地風空)。防御側の element と相性判定。未指定は無属性 (等倍)。 */
      element?: Element;
      /** 対象 (マルチ戦闘 #453)。未指定は oneEnemy。allEnemies で全体魔法 (メテオ全体版等)。 */
      target?: SkillTarget;
      /** データ駆動の計算値参照 (§14.5)。'buffCount' = 使用者の自己バフ数 (感情爆発)。
       *  TODO: damage 側の 'missingHpRatio' と将来の 'weaponPower' を含め、§14.5 の scaleBy を
       *  共通型に寄せる (現状は effect 種別ごとに使う参照だけを許して二重定義になっている)。 */
      scaleBy?: 'buffCount';
      /** scaleBy の1件あたり倍率: amount ×= 1 + count × scaleFactor。未指定 0.4。 */
      scaleFactor?: number;
    }
  | {
      kind: 'heal';
      /** maxHp に対する回復割合 */
      ratio: number;
      /** 対象。self=使用者 / allAllies=味方全体 (巫女の全体回復)。未指定は self。 */
      target?: 'self' | 'allAllies';
    }
  | {
      kind: 'cleanse';
      /** 状態異常回復 (浄化/払串)。self=使用者 / allAllies=味方全体。デバフのみ除去 (バフは残す)。 */
      target: 'self' | 'allAllies';
    }
  | {
      kind: 'restoreMp';
      /** maxMp に対する MP 回復割合 (サボる/野営)。使用者に。 */
      ratio: number;
    }
  | {
      kind: 'recoil';
      /** maxHp に対する反動ダメージ割合 (いちかばちか/絶唱)。使用者に。HP 1 未満にはしない。 */
      ratio: number;
    }
  | {
      kind: 'status';
      /** 付与する状態異常 */
      status: StatusId;
      /** 対象。self=使用者 / enemy=単体敵 / allEnemies=敵全体 (デバフ) / allAllies=味方全体 (バフ)。
       *  マルチ戦闘 (#453) 用に allEnemies/allAllies を追加。ソロでは enemy=allEnemies=単体。 */
      target: 'self' | 'enemy' | 'allEnemies' | 'allAllies';
      chance?: number;
      turns?: number;
      magnitude?: number;
      /** magnitude への int 連動 (破滅の予言など。付与時に +round(attacker.int × magIntBonus))。
       *  ダメージ系状態 (doomMark/poison) を int キャスターのステで伸ばすのに使う。 */
      magIntBonus?: number;
    };

export interface SkillDef {
  /** とくぎ ID (JobSkill.kind と一致させる) */
  id: string;
  effects: SkillEffect[];
  /** 見切り/大盾の護り: 「防御しつつ反撃」を宣言する (resolveTurn が parrying フラグを立てる)。
   *  宣言型なので effects は空でよい (反撃は doAttack の parrying 経路)。 */
  parry?: boolean;
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
  // 背水の陣: 使用者の失った HP 割合ぶん power を伸ばす (HP 低いほど威力↑)。
  let basePower = effect.power ?? 1;
  if (effect.scaleBy === 'missingHpRatio') {
    const missing = attacker.maxHp > 0 ? 1 - attacker.hp / attacker.maxHp : 0;
    basePower *= 1 + missing * (effect.scaleFactor ?? 1.0);
  }
  for (let i = 0; i < hits; i++) {
    // 対象が倒れていたら以降の追撃は無駄撃ちしない (flurry の 2 撃目 = 従来挙動)。
    if (defender.hp <= 0) break;
    const opts: AttackOptions = { label: skillName, power: basePower };
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
      case 'def':
        opts.atkOverride = attacker.def; // 守護者の盾殴り: 守りの固さで殴る (def43 型)
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
        events.push({ actor, text: statusApplyText(inf.status, defender.name) });
      }
    }
  }
};

/** status: 使用者 (self) or 相手 (enemy) に状態異常を付与 (バフ/デバフ/かくれみ)。 */
const statusHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'status') return;
  const { attacker, defender, rng, events } = ctx;
  const actor = ctx.actorSide ?? 'player';
  // 倒した相手にデバフを乗せない (fixedDamage で致死後に走る多段技のため)。self 以外は死体スキップ
  // (enemy/allEnemies/oneEnemy をまとめて。self バフは生死問わず対象)。
  if (effect.target !== 'self' && defender.hp <= 0) return;
  if (rng() >= (effect.chance ?? 1)) return;
  const target = effect.target === 'self' ? attacker : defender;
  // magnitude に int 連動を足す (破滅の予言の炸裂を int キャスターのステで伸ばす。レビュー ★★)。
  const mag =
    effect.magnitude !== undefined || effect.magIntBonus !== undefined
      ? (effect.magnitude ?? 0) + (effect.magIntBonus ? Math.round(attacker.int * effect.magIntBonus) : 0)
      : undefined;
  // 名演 (吟遊詩人): 付与する側 (attacker) の持続延長パッシブを適用 (none なら素通し)。歌の効果 +1 ターン。
  const hookCtx: HookCtx = { rng, events, actor };
  const turns = applyStatusDurationBonus(effect.turns ?? DEFAULT_STATUS_TURNS, attacker, hookCtx);
  applyStatus(target, {
    id: effect.status,
    turns,
    ...(mag !== undefined ? { magnitude: mag } : {}),
  });
  // 付与を告知 (無告知だとプレイヤーが状態変化を認識できない。レビュー ★★)。
  events.push({ actor, text: statusApplyText(effect.status, target.name) });
};

/** 自己バフとして数える状態 (感情爆発の buffCount)。積み重ねてダメージに変換する。 */
const BUFF_STATUSES: ReadonlySet<StatusId> = new Set<StatusId>(['atkUp', 'defUp', 'agiUp']);

/** デバフ (浄化 cleanse で除去する状態)。負の状態異常の正準集合は statuses.ts の AILMENT_IDS に一本化
 *  (審美眼の「状態異常の敵」判定と同概念)。新デバフを足すときは AILMENT_IDS 側に追記する。 */
const DEBUFF_STATUSES = AILMENT_IDS;

/** 使用者の自己バフ数 (scaleBy: 'buffCount' 用)。 */
function countBuffs(c: Combatant): number {
  return (c.statuses ?? []).filter((s) => BUFF_STATUSES.has(s.id)).length;
}

/** fixedDamage: 範囲ロール + int/luk 連動 → doMagic (必中・def無視・属性相性)。DQ 流の魔法。 */
const fixedDamageHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'fixedDamage') return;
  const { attacker, defender, rng, events, engine, skillName } = ctx;
  const actor = ctx.actorSide ?? 'player';
  if (defender.hp <= 0) return;
  const span = effect.max - effect.min;
  let amount = effect.min + Math.floor(rng() * (span + 1));
  if (effect.intBonus) amount += attacker.int * effect.intBonus;
  if (effect.luckScale) amount += attacker.luk * effect.luckScale;
  if (effect.scaleBy === 'buffCount') amount *= 1 + countBuffs(attacker) * (effect.scaleFactor ?? 0.4);
  engine.doMagic(attacker, defender, rng, events, actor, {
    amount,
    ...(effect.element ? { element: effect.element } : {}),
    label: skillName,
  });
};

/** heal: 対象 (resolveTargets 済みの ctx.defender) の maxHp 割合ぶん回復。self は defender=attacker、
 *  allAllies は各味方に解決される (runSkillMulti が対象ごとに defender を差し替える)。 */
const healHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'heal') return;
  const { defender, events, skillName } = ctx;
  const heal = Math.round(defender.maxHp * effect.ratio);
  defender.hp = Math.min(defender.maxHp, defender.hp + heal);
  events.push({ actor: ctx.actorSide ?? 'player', text: `${defender.name}は${skillName}! HP が ${heal} 回復。` });
};

/** cleanse: 味方対象のデバフを除去 (浄化)。バフは残す。self は使用者、それ以外は解決済みの味方。 */
const cleanseHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'cleanse') return;
  const { attacker, defender, events } = ctx;
  const actor = ctx.actorSide ?? 'player';
  // ソロ runSkill は ctx.defender=敵 固定なので、self は attacker を対象にする (敵を浄化しない)。
  // マルチ runSkillMulti は allAllies を各味方に解決して defender に載せる。
  const target = effect.target === 'self' ? attacker : defender;
  if (!target.statuses || target.statuses.length === 0) return;
  const had = target.statuses.some((s) => DEBUFF_STATUSES.has(s.id));
  target.statuses = target.statuses.filter((s) => !DEBUFF_STATUSES.has(s.id));
  if (had) events.push({ actor, text: `${target.name}の状態異常が回復した!` });
};

/** restoreMp: 使用者の MP を maxMp の割合ぶん回復 (サボる/野営)。 */
const restoreMpHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'restoreMp') return;
  const { attacker, events, skillName } = ctx;
  const gain = Math.round(attacker.maxMp * effect.ratio);
  attacker.mp = Math.min(attacker.maxMp, attacker.mp + gain);
  events.push({ actor: ctx.actorSide ?? 'player', text: `${attacker.name}は${skillName}! MP が ${gain} 回復。` });
};

/** recoil: 使用者に反動ダメージ (maxHp 割合)。HP 1 未満にはしない (自滅は sim 調整後に検討)。 */
const recoilHandler: EffectHandler = (effect, ctx) => {
  if (effect.kind !== 'recoil') return;
  const { attacker, events } = ctx;
  const dmg = Math.round(attacker.maxHp * effect.ratio);
  attacker.hp = Math.max(1, attacker.hp - dmg);
  events.push({ actor: ctx.actorSide ?? 'player', text: `${attacker.name}は反動で ${dmg} のダメージ!` });
};

/** 効果種別 → ハンドラ。ここに 1 行足す = 新しい効果プリミティブが使えるようになる。 */
export const EFFECT_HANDLERS: Record<SkillEffect['kind'], EffectHandler> = {
  damage: damageHandler,
  fixedDamage: fixedDamageHandler,
  heal: healHandler,
  status: statusHandler,
  cleanse: cleanseHandler,
  restoreMp: restoreMpHandler,
  recoil: recoilHandler,
};

/**
 * とくぎ定義レジストリ (id → SkillDef)。既存 6 種を移行 (挙動は従来と同一)。
 * 新しいとくぎは **ここに 1 エントリ追加するだけ**。
 */
export const SKILLS: Record<string, SkillDef> = {
  // 強打: atk 基準 1.7 倍・やや当てにくい
  smash: { id: 'smash', effects: [{ kind: 'damage', stat: 'atk', power: 1.7, hitBonus: -0.1 }] },
  // 見切り: 宣言は resolveTurn 冒頭 (行動順に依存しない)。防御しつつ反撃。
  parry: { id: 'parry', effects: [], parry: true },
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

  // ─── 魔法使い 確定キット (#456 / docs/25 §12。単体・int型・必中・def無視) ───
  // 数値 (範囲/intBonus/デバフ turns) は **sim 調整前提の暫定値**。覚える Lv に見合う endgame 敵
  // (#455) が要る高 Lv 技は数値を圧縮しない (オーナー方針)。属性の輪は §1。
  'mage-flame': { id: 'mage-flame', effects: [{ kind: 'fixedDamage', min: 4, max: 8, intBonus: 0.2, element: 'fire' }] }, // 火炎術式 Lv3
  'mage-decode': { id: 'mage-decode', effects: [{ kind: 'fixedDamage', min: 6, max: 11, intBonus: 0.2 }] }, // 解式マギア Lv5 (無属性)
  'mage-stone': { id: 'mage-stone', effects: [{ kind: 'fixedDamage', min: 7, max: 12, intBonus: 0.2, element: 'earth' }] }, // 石射 Lv6
  // 氷結術式 Lv8: 水 + 素早さ↓
  'mage-freeze': {
    id: 'mage-freeze',
    effects: [
      { kind: 'fixedDamage', min: 8, max: 14, intBonus: 0.25, element: 'water' },
      { kind: 'status', status: 'agiDown', target: 'enemy', turns: 3 },
    ],
  },
  // メルティ Lv12: 火 + 敵 def↓
  'mage-melt': {
    id: 'mage-melt',
    effects: [
      { kind: 'fixedDamage', min: 10, max: 16, intBonus: 0.25, element: 'fire' },
      { kind: 'status', status: 'defDown', target: 'enemy', turns: 3 },
    ],
  },
  'mage-blaze': { id: 'mage-blaze', effects: [{ kind: 'fixedDamage', min: 16, max: 24, intBonus: 0.3, element: 'fire' }] }, // 爆炎術式 Lv15
  'mage-quake': { id: 'mage-quake', effects: [{ kind: 'fixedDamage', min: 20, max: 28, intBonus: 0.35, element: 'earth' }] }, // じわれ Lv18 (飛行無効は #455)
  // 永久凍土 Lv20: 水 + 3T 行動不可 (stun turns=3)
  'mage-permafrost': {
    id: 'mage-permafrost',
    effects: [
      { kind: 'fixedDamage', min: 12, max: 18, intBonus: 0.3, element: 'water' },
      { kind: 'status', status: 'stun', target: 'enemy', turns: 3 },
    ],
  },
  'mage-meteor': { id: 'mage-meteor', effects: [{ kind: 'fixedDamage', min: 30, max: 45, intBonus: 0.4 }] }, // メテオ Lv25 (無属性大砲)
  // 魔力障壁 Lv30 (常時 被ダメ軽減) はパッシブ。PASSIVES + player.passives 配線が要るため後続で追加 (TODO)。

  // ─── 忍者 確定キット (#456 / docs/25 §7・§14.1。agi型・毒/隠密/会心) ───
  // 数値は sim 調整前提の暫定値。影分身 Lv20 / 首狩り Lv30 (P) は後続 (要 evade多重/召喚 or passive)。
  // 毒手 Lv3: agi 物理 (軽) + 高確率で毒 (§7: power0.7 / chance0.8 / turns3)。
  // magnitude は §7 では範囲 [1,3] だが poison の範囲ロールは未実装のため固定 2 (範囲対応は別 issue)。
  'ninja-poison-hand': {
    id: 'ninja-poison-hand',
    effects: [{ kind: 'damage', stat: 'agi', power: 0.7, inflict: { status: 'poison', chance: 0.8, turns: 3, magnitude: 2 } }],
  },
  // かくれみ Lv5: 自分にかくれみ (回避↑。安全に やくそう 回復するための布石。行動 or 被弾で解除)
  'ninja-hide': { id: 'ninja-hide', effects: [{ kind: 'status', status: 'hidden', target: 'self', turns: 3 }] },
  // 火遁 Lv8: 火属性の術 (必中・def無視)。忍者は int 低めなので intBonus 控えめ
  'ninja-katon': { id: 'ninja-katon', effects: [{ kind: 'fixedDamage', min: 8, max: 14, intBonus: 0.12, element: 'fire' }] },
  // 急所狙い Lv12: agi 物理 1.5 倍 + 命中で 1 ターン麻痺 (§7 確定版どおり)
  'ninja-vitals': {
    id: 'ninja-vitals',
    effects: [{ kind: 'damage', stat: 'agi', power: 1.5, inflict: { status: 'stun', chance: 1.0, turns: 1 } }],
  },
  // 九字切り Lv15: 次の一撃を確定会心 (メタル系を会心で貫く)。turns:1 = fresh スキップにより付与ターンは
  // 畳まれず、次ターンの攻撃で確定会心 → clearOnAct で除去。
  'ninja-kuji': { id: 'ninja-kuji', effects: [{ kind: 'status', status: 'critCharge', target: 'self', turns: 1 }] },

  // ─── 詩人 確定キット (#456 / docs/25 §12。水属性・自己バフ火力・言葉の拘束) ───
  // 数値は sim 調整前提の暫定値。感傷(会心↑)/感情爆発(scaleBy)/全体技/詩心(P) は後続 (要 新語彙)。
  // 心晴の韻 Lv3: 水属性魔法。詩人の強み luk (34) 連動 (int8 は最低クラスなので luckScale に。§423 luk型)。
  'poet-verse': { id: 'poet-verse', effects: [{ kind: 'fixedDamage', min: 4, max: 12, luckScale: 0.2, element: 'water' }] },
  'poet-calm': { id: 'poet-calm', effects: [{ kind: 'status', status: 'defUp', target: 'self', turns: 3 }] }, // 静心 Lv5
  'poet-rouse': { id: 'poet-rouse', effects: [{ kind: 'status', status: 'atkUp', target: 'self', turns: 3 }] }, // 昂ぶりの詩 Lv7
  // 言の葉縛り Lv8: 敵を束縛 (1-2T 行動不可・被弾で解けない)
  'poet-bind': { id: 'poet-bind', effects: [{ kind: 'status', status: 'restraint', target: 'enemy', chance: 0.7, turns: 2 }] },
  'poet-mushin': { id: 'poet-mushin', effects: [{ kind: 'status', status: 'agiUp', target: 'self', turns: 3 }] }, // 無心 Lv12 (回避↑。次被ダメ半減は barrier 未実装で後続)
  // 感情爆発 Lv20: 水属性・単体大ダメージ。**今の自己バフ数 × 係数**で威力が伸びる (§12/§14.5 scaleBy)。
  // 自己バフを積んでから撃つ = 詩人「自己バフ火力」の核 (buff→爆発ループの payoff)。
  'poet-outburst': {
    id: 'poet-outburst',
    effects: [{ kind: 'fixedDamage', min: 12, max: 22, luckScale: 0.2, element: 'water', scaleBy: 'buffCount', scaleFactor: 0.5 }],
  },
  // 心の詩 Lv22: 自分の全能力↑ (atk/def/agi を一括バフ = 複数 effect 合成)
  'poet-song': {
    id: 'poet-song',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'self', turns: 3 },
      { kind: 'status', status: 'defUp', target: 'self', turns: 3 },
      { kind: 'status', status: 'agiUp', target: 'self', turns: 3 },
    ],
  },

  // ─── 戦士 確定キット (#456 / docs/25 §12。純物理ブルーザー・無属性) ───
  // 数値は sim 調整前提の暫定値。なぎ払い/一騎当千(全体)・剣豪(P) は後続。かばう/挑発は §12 で一旦保留。
  'warrior-thrust': { id: 'warrior-thrust', effects: [{ kind: 'damage', stat: 'atk', power: 0.7, hits: 2 }] }, // みだれ突き Lv5
  // かぶとわり Lv10: atk 1.3 倍 + 命中で守備力↓ (継続戦の布石)
  'warrior-helmsplit': {
    id: 'warrior-helmsplit',
    effects: [{ kind: 'damage', stat: 'atk', power: 1.3, inflict: { status: 'defDown', chance: 0.8, turns: 3 } }],
  },
  'warrior-charge': { id: 'warrior-charge', effects: [{ kind: 'status', status: 'atkUp', target: 'self', turns: 2 }] }, // ためる Lv15 (次撃強化)
  'warrior-fullslash': { id: 'warrior-fullslash', effects: [{ kind: 'damage', stat: 'atk', power: 2.0 }] }, // 全力斬り Lv18

  // ─── 聖騎士 確定キット (#456 / docs/25 §12。前衛・聖なる支援・holy=無属性) ───
  // 数値は sim 調整前提の暫定値。裁きの光/女神降臨(全体)・聖光斬(int補正物理)・清き心(P魔法反射) は後続。
  // 光の加護は §14.7 のフラット加算バフだが、フラット機構は未実装のため暫定で乗算バフ (atk/def/agiUp)。
  'paladin-heal': { id: 'paladin-heal', effects: [{ kind: 'heal', ratio: 0.3 }] }, // 聖光の癒し Lv3
  // 光の加護 Lv5: 自分の攻/守/速を強化 (§14.7 フラット化は後続 issue)
  'paladin-blessing': {
    id: 'paladin-blessing',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'self', turns: 3 },
      { kind: 'status', status: 'defUp', target: 'self', turns: 3 },
      { kind: 'status', status: 'agiUp', target: 'self', turns: 3 },
    ],
  },
  // 光の剣 Lv8: 無属性 (holy) 魔法・必中・def無視。§12 の "int差luck" と聖騎士の最強ステ luk34 を活かし
  // int + luk の両刀に (int 単独だと最強 luk を無視してしまう。レビュー ★★)。範囲は §12 の 15-20 に寄せた。
  'paladin-lightblade': { id: 'paladin-lightblade', effects: [{ kind: 'fixedDamage', min: 12, max: 18, intBonus: 0.2, luckScale: 0.2 }] },
  // 聖なる守り Lv15: 自 def を強めに上げる (defUp magnitude 0.6 = 被ダメ ×0.6)
  'paladin-guard': { id: 'paladin-guard', effects: [{ kind: 'status', status: 'defUp', target: 'self', turns: 3, magnitude: 0.6 }] },
  // 浄化 Lv18: 自分のデバフを回復 (cleanse)
  'paladin-purify': { id: 'paladin-purify', effects: [{ kind: 'cleanse', target: 'self' }] },

  // ─── 遊び人 確定キット (#456 / docs/25 §12・§14.1。luk/agi 型・運任せ) ───
  // 数値は sim 調整前提の暫定値。ぶんどり(gain)/ルーレット・大道芸(random)/せっとく(resolve) は
  // 要 新語彙のため後続。ここは restoreMp/recoil/連撃で成立する単体サブセット。
  // サボる Lv5: MP 回復 + 少し HP 回復 (怠けて休む)
  'performer-slack': {
    id: 'performer-slack',
    effects: [
      { kind: 'restoreMp', ratio: 0.4 },
      { kind: 'heal', ratio: 0.15 },
    ],
  },
  // いちかばちか Lv12: **agi 基準** (遊び人の最強ステ) の大博打 + 反動。運任せ感は gamble の抽選幅と
  // luk 依存の下限 (lukFloorScale) で表現する。基準を弱ステ luk にすると看板技が最弱火力になる (レビュー ★★★)。
  'performer-gamble': {
    id: 'performer-gamble',
    effects: [
      { kind: 'damage', stat: 'agi', gamble: { max: 3.0, lukFloorScale: 0.012, lukFloorCap: 0.6 } },
      { kind: 'recoil', ratio: 0.15 },
    ],
  },
  // 曲芸乱舞 Lv15: agi 基準 3 連撃
  'performer-acrobat': { id: 'performer-acrobat', effects: [{ kind: 'damage', stat: 'agi', power: 0.6, hits: 3 }] },

  // ─── 賢者 確定キット (#456 / docs/25 §12。最高 int・全5属性・支援) ───
  // 数値は sim 調整前提の暫定値。全属性魔法 (火水地風空) を必中・def無視で撃つ。イディオット(intDown)/
  // 知恵の加護(intUp)/星辰以外の全体技/慧眼(P) は要 新語彙のため後続。属性の輪 (§1) をフル活用。
  'sage-flame': { id: 'sage-flame', effects: [{ kind: 'fixedDamage', min: 5, max: 10, intBonus: 0.25, element: 'fire' }] }, // 火炎 Lv3
  'sage-decode': { id: 'sage-decode', effects: [{ kind: 'fixedDamage', min: 6, max: 11, intBonus: 0.25 }] }, // 解式 Lv5 (無属性)
  'sage-stone': { id: 'sage-stone', effects: [{ kind: 'fixedDamage', min: 7, max: 12, intBonus: 0.25, element: 'earth' }] }, // 石射 Lv6
  // 氷結 Lv8: 水 + 素早さ↓
  'sage-frost': {
    id: 'sage-frost',
    effects: [
      { kind: 'fixedDamage', min: 8, max: 14, intBonus: 0.3, element: 'water' },
      { kind: 'status', status: 'agiDown', target: 'enemy', turns: 3 },
    ],
  },
  'sage-gale': { id: 'sage-gale', effects: [{ kind: 'fixedDamage', min: 10, max: 16, intBonus: 0.3, element: 'wind' }] }, // 疾風 Lv10
  'sage-revelation': { id: 'sage-revelation', effects: [{ kind: 'fixedDamage', min: 12, max: 18, intBonus: 0.3, element: 'void' }] }, // 天啓 Lv12 (空)
  'sage-heal': { id: 'sage-heal', effects: [{ kind: 'heal', ratio: 0.35 }] }, // 賢者の癒し Lv16
  'sage-starlight': { id: 'sage-starlight', effects: [{ kind: 'fixedDamage', min: 25, max: 40, intBonus: 0.4, element: 'void' }] }, // 星辰の大魔法 Lv22

  // ─── 予言者 確定キット (#456 / docs/25 §12。最高 int・破滅のオラクル・遅延) ───
  // 数値は sim 調整前提の暫定値。int 連動の必中魔法 + 破滅の予言 (doomMark)。全体予言 (地震/嵐/日照り/
  // 水難/アポカリプス) はマルチ (#453) 待ち。死の宣告 (毎ターンHP半分)/未来予知 (magicEvade)/全知(P) は後続。
  'seer-switch': { id: 'seer-switch', effects: [{ kind: 'fixedDamage', min: 4, max: 10, intBonus: 0.2 }] }, // 未来スイッチ Lv3 (回避不能=必中)
  'seer-thunder': { id: 'seer-thunder', effects: [{ kind: 'fixedDamage', min: 6, max: 12, intBonus: 0.3 }] }, // 雷の予言 Lv4 (無属性・必中)
  'seer-poison': { id: 'seer-poison', effects: [{ kind: 'status', status: 'poison', target: 'enemy', turns: 4, magnitude: 3 }] }, // 毒の予言 Lv7
  // 破滅の予言 Lv12: doomMark を付与 (数ターン後に大ダメージ炸裂)。炸裂は int 連動 (基礎15 + int×0.3)。
  'seer-doom': { id: 'seer-doom', effects: [{ kind: 'status', status: 'doomMark', target: 'enemy', turns: 3, magnitude: 15, magIntBonus: 0.3 }] },
  'seer-king': { id: 'seer-king', effects: [{ kind: 'fixedDamage', min: 28, max: 42, intBonus: 0.4 }] }, // 蠱毒の王 Lv20 (必中大砲)

  // ─── 将軍 確定キット (#456 / docs/25 §12。最強 atk39・最脆 def10・物理一本・対キャスター) ───
  // 数値は sim 調整前提の暫定値。なぎ倒し/勝鬨(全体)・覇王(P onLethal)・見切り/鬼神斬りの魔法かき消し
  // (magicEvade/onEnemyCast) は後続。int28 の魔法耐性活用も敵魔法詠唱 (#455後続) 待ち。
  'shogun-flash': { id: 'shogun-flash', effects: [{ kind: 'damage', stat: 'atk', power: 1.5 }] }, // 一閃 Lv3
  // 足払い Lv8: atk 1.2 + 高確率で転倒 (次行動不可 + 被ダメ↑)
  'shogun-sweep': {
    id: 'shogun-sweep',
    effects: [{ kind: 'damage', stat: 'atk', power: 1.2, inflict: { status: 'tumble', chance: 0.7, turns: 1 } }],
  },
  // 見切り Lv15: 回避を大きく上げる構え (magnitude 2.5)。将軍は素の agi13 が低く乗算バフが効きにくい
  // ため強めに。§12 の「次の敵魔法100%回避」は magicEvade (敵魔法詠唱 #455後続) が入るまで後続。
  'shogun-guard': { id: 'shogun-guard', effects: [{ kind: 'status', status: 'agiUp', target: 'self', turns: 3, magnitude: 2.5 }] },
  'shogun-oni': { id: 'shogun-oni', effects: [{ kind: 'damage', stat: 'atk', power: 2.5 }] }, // 鬼神斬り Lv20 (かき消しは後続)

  // ─── 隊長 確定キット (#456 / docs/25 §12。タフな前衛指揮官・鼓舞) ───
  // 数値は sim 調整前提の暫定値。全体バフ/デバフ (allAllies/allEnemies) はソロでは自己バフ/敵デバフに
  // 退化し、マルチ (#453) で味方全体/敵全体に効く。名将 (P atk/def+10%) は passive 配線待ちで後続。
  // 突撃号令 Lv3: atk×1.5 + 味方に atk 微上昇 (allAllies=ソロは自分)。
  // 注意: atkUp は restack refresh なので、鼓舞 (1.30) の後に突撃号令 (1.15) を撃つとバフが下がる。
  // sim 調整時に「オマケ側を鼓舞と同値」or「refresh を max 採用」を検討 (#460)。
  'captain-charge': {
    id: 'captain-charge',
    effects: [
      { kind: 'damage', stat: 'atk', power: 1.5 },
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3, magnitude: 1.15 },
    ],
  },
  'captain-inspire': { id: 'captain-inspire', effects: [{ kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3 }] }, // 鼓舞 Lv5
  'captain-defense': { id: 'captain-defense', effects: [{ kind: 'status', status: 'defUp', target: 'allAllies', turns: 3 }] }, // 防陣 Lv8
  // 突進 Lv12: atk×1.5 + 中確率で転倒
  'captain-rush': {
    id: 'captain-rush',
    effects: [{ kind: 'damage', stat: 'atk', power: 1.5, inflict: { status: 'tumble', chance: 0.5, turns: 1 } }],
  },
  // 檄 Lv15: 味方全体 atk↑ + agi↑
  'captain-rally': {
    id: 'captain-rally',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3 },
      { kind: 'status', status: 'agiUp', target: 'allAllies', turns: 3 },
    ],
  },
  // 捨て身攻撃 Lv18: 敵全体 atk×1.6・自 def↓ (リスク)。§12 の「会心↑」は critUp 語彙が未整備で後続。
  'captain-desperate': {
    id: 'captain-desperate',
    effects: [
      { kind: 'damage', stat: 'atk', power: 1.6, target: 'allEnemies' },
      { kind: 'status', status: 'defDown', target: 'self', turns: 1 },
    ],
  },
  // 攻陣 Lv25: 敵を囲い 味方 atk↑ + 敵 agi↓ (§12 確定版: 鼓舞と包囲のハイブリッド陣形)
  'captain-encircle': {
    id: 'captain-encircle',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3 },
      { kind: 'status', status: 'agiDown', target: 'allEnemies', turns: 3 },
    ],
  },

  // ─── 巫女 確定キット (#456 / docs/25 §12。luk型・霊的支援・物理攻撃なし・全体技) ───
  // 数値は sim 調整前提の暫定値。全体技はソロで自己/敵単体に退化、マルチで全体化。luk37 最強なので
  // 攻撃は wind luckScale。魅惑の神楽(confusion)/神楽乱舞/神託の光/巫女の直感(P) は後続。
  'miko-heal-bell': { id: 'miko-heal-bell', effects: [{ kind: 'heal', ratio: 0.2, target: 'allAllies' }] }, // 癒しの鈴 Lv3
  'miko-wind-dance': { id: 'miko-wind-dance', effects: [{ kind: 'fixedDamage', min: 5, max: 12, luckScale: 0.2, element: 'wind', target: 'allEnemies' }] }, // 風の舞 Lv5
  'miko-sleep-bell': { id: 'miko-sleep-bell', effects: [{ kind: 'status', status: 'sleep', target: 'allEnemies', chance: 0.6, turns: 3 }] }, // 眠りの鈴 Lv8
  // 加護 Lv12: 味方 atk↑ + def↑
  'miko-blessing': {
    id: 'miko-blessing',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3 },
      { kind: 'status', status: 'defUp', target: 'allAllies', turns: 3 },
    ],
  },
  'miko-purify-dance': { id: 'miko-purify-dance', effects: [{ kind: 'fixedDamage', min: 8, max: 16, luckScale: 0.25, element: 'wind', target: 'allEnemies' }] }, // 破魔の舞 Lv15
  'miko-heal-kagura': { id: 'miko-heal-kagura', effects: [{ kind: 'heal', ratio: 0.4, target: 'allAllies' }] }, // 癒し神楽 Lv18
  'miko-cleanse': { id: 'miko-cleanse', effects: [{ kind: 'cleanse', target: 'allAllies' }] }, // 払串 Lv22

  // ─── 吟遊詩人 確定キット (#456 / docs/25 §12。agi/luk型・空属性・歌でバフ/デバフ/眠り・回復なし) ───
  // 数値は sim 調整前提の暫定値。luk31 最強で空属性 luckScale。スタッカート/カプリッチョ(random)/
  // 英雄叙事詩(全能力2倍)/名演(P) は後続。**新プリミティブ追加なし**。
  // プレリュード Lv3: 味方 atk↑ + agi↑
  'bard-prelude': {
    id: 'bard-prelude',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3 },
      { kind: 'status', status: 'agiUp', target: 'allAllies', turns: 3 },
    ],
  },
  'bard-desperado': { id: 'bard-desperado', effects: [{ kind: 'fixedDamage', min: 3, max: 10, luckScale: 0.2, element: 'void', target: 'allEnemies' }] }, // デスペラード Lv5
  'bard-lullaby': { id: 'bard-lullaby', effects: [{ kind: 'status', status: 'sleep', target: 'allEnemies', chance: 0.6, turns: 3 }] }, // ララバイ Lv8
  'bard-scherzo': { id: 'bard-scherzo', effects: [{ kind: 'status', status: 'agiUp', target: 'allAllies', turns: 3, magnitude: 2.0 }] }, // スケルツォ Lv12 (agi 2倍)
  // ディスコード Lv14: 敵 atk↓ + def↓
  'bard-discord': {
    id: 'bard-discord',
    effects: [
      { kind: 'status', status: 'atkDown', target: 'allEnemies', turns: 3 },
      { kind: 'status', status: 'defDown', target: 'allEnemies', turns: 3 },
    ],
  },
  // ラプソディ Lv15: 味方 atk を強めに (1.5倍) + def は標準 (被ダメ ×0.7)。数値は sim 調整前提。
  'bard-rhapsody': {
    id: 'bard-rhapsody',
    effects: [
      { kind: 'status', status: 'atkUp', target: 'allAllies', turns: 3, magnitude: 1.5 },
      { kind: 'status', status: 'defUp', target: 'allAllies', turns: 3 },
    ],
  },
  'bard-applause': { id: 'bard-applause', effects: [{ kind: 'fixedDamage', min: 10, max: 18, luckScale: 0.3, element: 'void', target: 'allEnemies' }] }, // アプローズ Lv25

  // ─── 守護者 確定キット (#456 / docs/25 §12・§14.1。壁役・def43最強) ───
  // 数値は sim 調整前提の暫定値。盾殴りは def 基準 (守りの固さで殴る)。フルカウンター(累積反射)/
  // 不動(P onLethal)/かばう・挑発(パーティ前提=マルチ #453) は後続。
  'guardian-bash': { id: 'guardian-bash', effects: [{ kind: 'damage', stat: 'def', power: 1.0 }] }, // 盾殴り Lv3
  'guardian-prayer': { id: 'guardian-prayer', effects: [{ kind: 'status', status: 'defUp', target: 'self', turns: 3, magnitude: 0.6 }] }, // 守護の祈り Lv5
  // とげの盾 Lv8: 物理被弾のみ反射 (doMagic では非発火。§14.1 の「物理被弾時」に準拠)。
  'guardian-thorns': { id: 'guardian-thorns', effects: [{ kind: 'status', status: 'thorns', target: 'self', turns: 3, magnitude: 0.3 }] },
  'guardian-stand': { id: 'guardian-stand', effects: [{ kind: 'status', status: 'ironWall', target: 'self', turns: 1 }] }, // 仁王立ち Lv12 (被ダメ≒0 1T)
  'guardian-shield': { id: 'guardian-shield', effects: [], parry: true }, // 大盾の護り Lv15 (parry: 防御しつつ反撃)

  // ─── 冒険者 確定キット (#456 / docs/25 §12。万能スカーミッシャー・luk34/agi25・生存/逆転) ───
  // 数値は sim 調整前提の暫定値。武器投げ(装備 #454)/秘境探索(random)/全体技/旅の勘(P) は後続。
  'explorer-pebble': { id: 'explorer-pebble', effects: [{ kind: 'fixedDamage', min: 4, max: 12, luckScale: 0.2, element: 'earth' }] }, // 石つぶて Lv3
  'explorer-snare': { id: 'explorer-snare', effects: [{ kind: 'status', status: 'agiDown', target: 'enemy', turns: 3 }] }, // 足がらめ Lv5
  'explorer-reveal': { id: 'explorer-reveal', effects: [{ kind: 'status', status: 'defDown', target: 'enemy', turns: 3 }] }, // みやぶる Lv7 (弱点表示は後続)
  // サバイバル Lv8: HP 回復 + MP 少回復 (旅の知恵)
  'explorer-survival': {
    id: 'explorer-survival',
    effects: [
      { kind: 'heal', ratio: 0.25 },
      { kind: 'restoreMp', ratio: 0.2 },
    ],
  },
  'explorer-gale': { id: 'explorer-gale', effects: [{ kind: 'fixedDamage', min: 8, max: 16, luckScale: 0.25, element: 'wind' }] }, // 疾風の一撃 Lv10 (先制は後続)
  'explorer-confuse': { id: 'explorer-confuse', effects: [{ kind: 'status', status: 'accDown', target: 'allEnemies', turns: 3 }] }, // かく乱 Lv15
  // 一撃離脱 Lv18: 攻撃 + 自回避↑ (ヒットアンドアウェイ)
  'explorer-hitrun': {
    id: 'explorer-hitrun',
    effects: [
      { kind: 'fixedDamage', min: 12, max: 22, luckScale: 0.3 },
      { kind: 'status', status: 'agiUp', target: 'self', turns: 2 },
    ],
  },
  // 背水の陣 Lv25: luk 基準の特大 + 自 HP が低いほど威力↑ (scaleBy missingHpRatio)
  'explorer-lastditch': { id: 'explorer-lastditch', effects: [{ kind: 'damage', stat: 'luk', power: 1.5, scaleBy: 'missingHpRatio', scaleFactor: 2.0 }] },

  // ─── 芸術家 確定キット (#456 / docs/25 §12。幻術師・luk/def26・空属性魔法) ───
  // 数値は sim 調整前提の暫定値。だまし討ち/幻影の分身(evade-next)/創造の絵筆(summon)/混乱系/傑作(random)/
  // 審美眼(P) は後続 (要 新語彙)。
  'artist-bolt': { id: 'artist-bolt', effects: [{ kind: 'fixedDamage', min: 3, max: 12, luckScale: 0.2, element: 'void' }] }, // 色彩の弾 Lv3
  // 幻惑の色 Lv5: 敵の命中↓ + 攻撃↓
  'artist-daze': {
    id: 'artist-daze',
    effects: [
      { kind: 'status', status: 'accDown', target: 'enemy', turns: 3 },
      { kind: 'status', status: 'atkDown', target: 'enemy', turns: 3 },
    ],
  },
  'artist-trompe': { id: 'artist-trompe', effects: [{ kind: 'status', status: 'agiUp', target: 'self', turns: 3 }] }, // だまし絵 Lv7 (自回避↑)
  'artist-mist': { id: 'artist-mist', effects: [{ kind: 'fixedDamage', min: 4, max: 10, luckScale: 0.2, element: 'void', target: 'allEnemies' }] }, // 極彩の霧 Lv8 (混乱は後続)
  'artist-blind': { id: 'artist-blind', effects: [{ kind: 'status', status: 'accDown', target: 'allEnemies', turns: 3 }] }, // 目くらまし Lv10
  // 原色の刃 Lv12: 空 + 高確率で攻撃↓
  'artist-blade': {
    id: 'artist-blade',
    effects: [
      { kind: 'fixedDamage', min: 10, max: 20, luckScale: 0.25, element: 'void' },
      { kind: 'status', status: 'atkDown', target: 'enemy', chance: 0.7, turns: 3 },
    ],
  },
  'artist-explosion': { id: 'artist-explosion', effects: [{ kind: 'fixedDamage', min: 15, max: 25, luckScale: 0.3, element: 'fire', target: 'allEnemies' }] }, // 芸術は爆発だ Lv15

  // ─── 匠 確定キット (#456 / docs/25 §12。からくり技師・罠と装置・int43・範囲) ───
  // 数値は sim 調整前提の暫定値。自爆人形(遅延全体)/からくり兵(summon)/大発破/兵器解放(全体)/発明家(P) は後続。
  'fighter-contraption': { id: 'fighter-contraption', effects: [{ kind: 'fixedDamage', min: 4, max: 12, intBonus: 0.2 }] }, // からくり仕掛け Lv3 (無属性・必中)
  'fighter-smoke': { id: 'fighter-smoke', effects: [{ kind: 'status', status: 'accDown', target: 'allEnemies', turns: 3 }] }, // 煙玉 Lv5
  'fighter-poisongas': { id: 'fighter-poisongas', effects: [{ kind: 'status', status: 'poison', target: 'enemy', turns: 4, magnitude: 3 }] }, // 毒煙装置 Lv7
  // 落とし穴 Lv8: 地属性 + 高確率で転倒
  'fighter-pitfall': {
    id: 'fighter-pitfall',
    effects: [
      { kind: 'fixedDamage', min: 5, max: 12, intBonus: 0.2, element: 'earth' },
      { kind: 'status', status: 'tumble', target: 'enemy', chance: 0.7, turns: 1 },
    ],
  },
  'fighter-ironball': { id: 'fighter-ironball', effects: [{ kind: 'fixedDamage', min: 8, max: 16, intBonus: 0.25 }] }, // 鉄球投擲 Lv10 (防御無視=fixedDamage は元々 def 無視)
  'fighter-flamethrower': { id: 'fighter-flamethrower', effects: [{ kind: 'fixedDamage', min: 10, max: 18, intBonus: 0.25, element: 'fire', target: 'allEnemies' }] }, // 火炎放射器 Lv12
  'fighter-net': { id: 'fighter-net', effects: [{ kind: 'status', status: 'restraint', target: 'enemy', chance: 0.7, turns: 2 }] }, // 拘束網 Lv15
  // 高圧放水 Lv18: 全体水 + 押し流し転倒
  'fighter-waterjet': {
    id: 'fighter-waterjet',
    effects: [
      { kind: 'fixedDamage', min: 10, max: 18, intBonus: 0.3, element: 'water', target: 'allEnemies' },
      { kind: 'status', status: 'tumble', target: 'allEnemies', chance: 0.5, turns: 1 },
    ],
  },
};

/** そのとくぎが「HP 回復のみ」か (UI が満タン時に無効化するかの判定に使う)。kind 文字列でなく
 *  効果ベースで判定するため、キット技 (paladin-heal 等) でも正しく効く。restoreMp+heal の
 *  サボる等は「純回復でない」= false (満タンでも MP 回復に撃てる)。 */
export function isPureHealSkill(kind: string): boolean {
  const def = SKILLS[kind];
  return !!def && def.effects.length > 0 && def.effects.every((e) => e.kind === 'heal');
}

/** SkillDef の全効果を単一 ctx.defender に解決する低レベル API (テスト用)。**production の解決は
 *  runSkillMulti** (ソロ/マルチとも効果ごとに resolveTargets で対象解決する) に統一済み (#456)。 */
export function runSkill(def: SkillDef, ctx: SkillContext): void {
  for (const effect of def.effects) {
    EFFECT_HANDLERS[effect.kind](effect, ctx);
  }
}

/** 各効果の対象種別 (SkillTarget) を導く。damage/fixedDamage は target 指定 or oneEnemy、
 *  heal は self、status は自身の target ('enemy'=oneEnemy に正規化)。 */
export function effectTarget(effect: SkillEffect): SkillTarget {
  switch (effect.kind) {
    case 'damage':
    case 'fixedDamage':
      return effect.target ?? 'oneEnemy';
    case 'heal':
      return effect.target ?? 'self';
    case 'restoreMp':
    case 'recoil':
      return 'self';
    case 'cleanse':
      return effect.target;
    case 'status':
      return effect.target === 'enemy' ? 'oneEnemy' : effect.target;
  }
}

/**
 * マルチ戦闘のとくぎ解決 (#453 / docs/25 §14.4)。**効果ごとに対象集合を解決**し、各対象に
 * ハンドラを適用する (self 効果は使用者 1 回、allEnemies は敵全員に、など)。ソロの runSkill と違い
 * ctx.defender を対象ごとに差し替える。`makeCtx` は対象 1 体分の SkillContext を組む注入関数。
 */
export function runSkillMulti(
  def: SkillDef,
  attacker: Combatant,
  sides: CombatSides,
  makeCtx: (defender: Combatant) => SkillContext,
  opts: { targetIndex?: number; label?: string; events?: TurnEvent[]; actor?: TurnEvent['actor'] } = {},
): void {
  // **技名を名乗る。** damage は doAttack、fixedDamage は doMagic が `${名前}の${技名}!` を
  // 出すが、純バフ・純回復の技はそこを通らないので、以前は「xの素早さがあがった!」だけが
  // 出ていた。選んだ技が本当に出たのか分からず、複数のとくぎを持つ職ほど困る
  // (オーナー報告 2026-07-27)。
  if (opts.label && opts.events && !def.effects.some((e) => e.kind === 'damage' || e.kind === 'fixedDamage')) {
    opts.events.push({ actor: opts.actor ?? 'player', text: `${attacker.name}の${opts.label}!` });
  }
  for (const effect of def.effects) {
    const targets = resolveTargets(attacker, effectTarget(effect), sides, opts);
    for (const target of targets) {
      EFFECT_HANDLERS[effect.kind](effect, makeCtx(target));
    }
  }
}
