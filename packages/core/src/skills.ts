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
import { applyStatus, statusApplyText, DEFAULT_STATUS_TURNS, type StatusId } from './statuses.js';
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
      /** int 連動ボーナス: +attacker.int × intBonus (int キャスター)。 */
      intBonus?: number;
      /** luk 連動ボーナス: +attacker.luk × luckScale (luk 型魔法: 巫女/芸術家/詩人。§423)。 */
      luckScale?: number;
      /** 攻撃属性 (火水地風空)。防御側の element と相性判定。未指定は無属性 (等倍)。 */
      element?: Element;
      /** データ駆動の計算値参照 (§14.5)。'buffCount' = 使用者の自己バフ数 (感情爆発)。 */
      scaleBy?: 'buffCount';
      /** scaleBy の1件あたり倍率: amount ×= 1 + count × scaleFactor。未指定 0.4。 */
      scaleFactor?: number;
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
  // 倒した相手にデバフを乗せない (fixedDamage で致死後に走る多段技のため。self バフは対象外)。
  if (effect.target === 'enemy' && defender.hp <= 0) return;
  if (rng() >= (effect.chance ?? 1)) return;
  const target = effect.target === 'self' ? attacker : defender;
  applyStatus(target, {
    id: effect.status,
    turns: effect.turns ?? DEFAULT_STATUS_TURNS,
    ...(effect.magnitude !== undefined ? { magnitude: effect.magnitude } : {}),
  });
  // 付与を告知 (無告知だとプレイヤーが状態変化を認識できない。レビュー ★★)。
  events.push({ actor, text: statusApplyText(effect.status, target.name) });
};

/** 自己バフとして数える状態 (感情爆発の buffCount)。積み重ねてダメージに変換する。 */
const BUFF_STATUSES: ReadonlySet<StatusId> = new Set<StatusId>(['atkUp', 'defUp', 'agiUp']);

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
};

/** SkillDef の全効果を順に解決する (プラグイン実行のエントリポイント)。 */
export function runSkill(def: SkillDef, ctx: SkillContext): void {
  for (const effect of def.effects) {
    EFFECT_HANDLERS[effect.kind](effect, ctx);
  }
}
