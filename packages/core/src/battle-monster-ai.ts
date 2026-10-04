/**
 * モンスターの行動選択 (能力プラグイン)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { BATTLE_TUNING } from './battle-tuning.js';
import { type Combatant } from './battle-combatant.js';
import { type MonsterDef, MONSTERS_BY_ID } from './battle-monsters.js';
import { type BattleState } from './battle-state.js';

/** モンスターの行動選択 (tier が高いほど賢い)。 */
/** モンスターの行動。'charge' = ため宣言、'heal' = 自己回復 (プレイヤーの Command とは別)。 */
type MonsterAction = 'attack' | 'guard' | 'charge' | 'heal' | 'flee' | 'cast';

/** モンスター能力プラグイン (#452 / docs/25 §5)。行動 AI を ability id → データ定義に置き、
 *  monsterCommand の if 分岐を排す。null を返すと通常判定 (plain) にフォールバック。 */
interface AbilityDecisionCtx {
  state: BattleState;
  /** 行動する敵個体 (#453: マルチ戦闘で敵ごとに判断。1v1 では state.monster と同じ)。 */
  monster: Combatant;
  /** そのターンの単一乱数 (全 ability で共有 = 決定性維持)。 */
  r: number;
  t: typeof BATTLE_TUNING;
  hpRatio: number;
  /** 低 HP で身を固める余地があるか (tier2+ かつ HP<35% かつ非ため中)。 */
  canGuard: boolean;
  monsterDef: MonsterDef | undefined;
}

interface AbilityDef {
  id: string;
  decideAction(ctx: AbilityDecisionCtx): MonsterAction | null;
}

/** 能力レジストリ。新しい敵 AI は CombatHook 同様「ここに 1 エントリ足すだけ」。 */
const MONSTER_ABILITIES: Record<string, AbilityDef> = {
  // charger: 1 ターン ため → 強攻撃 (予告を防御する読み合い。全体の ~20%)
  charger: {
    id: 'charger',
    decideAction: ({ monster, r, t, canGuard, monsterDef }) => {
      const chance = monsterDef?.abilityParams?.chargeChance ?? t.chargerChargeChance;
      if (monster.mp >= t.monsterChargeMpCost && r < chance) return 'charge';
      if (canGuard && r < chance + 0.15) return 'guard';
      return 'attack';
    },
  },
  // healer: 低 HP でたまに自己回復 (削り切る前に倒す読み合い)
  healer: {
    id: 'healer',
    decideAction: ({ monster, r, t, hpRatio, canGuard, monsterDef }) => {
      const low = monsterDef?.abilityParams?.lowHpRatio ?? t.healerLowHpRatio;
      const chance = monsterDef?.abilityParams?.healChance ?? t.healerHealChance;
      if (monster.mp >= t.monsterHealMpCost && hpRatio < low && r < chance) return 'heal';
      if (canGuard && r < chance + 0.15) return 'guard';
      return 'attack';
    },
  },
  // caster: MP があるうちは高確率で def 無視の属性魔撃を撃つ (#456)。対物理型 (覇王/不動) の弱点=魔法を
  // 成立させる (int 職の魔法耐性・聖騎士の魔法反射=清き心 は後続 #483 の前提)。MP 切れで通常攻撃に落ちる。
  caster: {
    id: 'caster',
    decideAction: ({ monster, r, t, canGuard, monsterDef }) => {
      const castChance = monsterDef?.abilityParams?.castChance ?? t.casterCastChance;
      if (monsterDef?.spell && monster.mp >= t.monsterCastMpCost && r < castChance) return 'cast';
      // guard バンドは charger/healer (+0.15) よりやや狭い +0.1 — caster は攻撃寄りに保ち、魔法を撃てない
      // (MP 枯渇) ターンも殴りに来る威圧感を残すため (守りに籠らせない)。
      if (canGuard && r < castChance + 0.1) return 'guard';
      return 'attack';
    },
  },
  // fleer: 毎ターン逃走を試みる (はぐれメタル型)。逃走率は**基準 agi (レベル非依存)** で決める —
  // factor でスケールする state.monster.agi を使うと高レベルほど逃走率が cap に張り付き、HP も
  // 上がって「成長するほど倒せない」逆進になる (レビュー ★★)。常に同じ緊張感にする。
  fleer: {
    id: 'fleer',
    decideAction: ({ r, t, monsterDef }) => {
      const baseAgi = monsterDef?.stats[2] ?? 0;
      const fleeBase = monsterDef?.abilityParams?.fleeBase ?? t.monsterFleeBase;
      const fleeChance = Math.min(t.monsterFleeMax, Math.max(0, fleeBase + baseAgi * t.monsterFleeAgiScale));
      if (r < fleeChance) return 'flee';
      return 'attack';
    },
  },
};

/** モンスターの行動を能力 (ability) で決める (ため攻撃は
 *  一部 (~20%) に限定し、回復する敵などバリエーションで戦略性を出す)。
 *  #452: if 分岐でなく MONSTER_ABILITIES レジストリ引き (プラグイン化)。 */
export function monsterCommand(monster: Combatant, state: BattleState, rng: () => number): MonsterAction {
  // 敵個体の monsterId で def を引く (#453: マルチ戦闘は敵ごとに別 def。1v1 は state.monsterId と一致)。
  const def = MONSTERS_BY_ID[monster.monsterId ?? state.monsterId];
  const t = BATTLE_TUNING;
  const r = rng();
  const hpRatio = monster.hp / monster.maxHp;
  // 低 HP でたまに身を固める (charger のため中は別処理なのでここでは除外)
  const canGuard = (def?.tier ?? 1) >= 2 && hpRatio < 0.35 && !monster.charging;

  // 複数対応 (#592 段階 2): 配列の先頭から聞き、**最初に特別な行動を返した能力を採る**。
  // 'attack' は「この能力は今回何もしない」の意味なので、次の能力に回す
  // (先頭が attack を返した瞬間に確定すると、2 番目以降が永久に発動しない)。
  const ids = def?.abilities ?? (def?.ability ? [def.ability] : []);
  for (const id of ids) {
    const action = MONSTER_ABILITIES[id]?.decideAction({ state, monster, r, t, hpRatio, canGuard, monsterDef: def });
    if (action && action !== 'attack') return action;
  }
  if (ids.length > 0) return 'attack';

  // plain (ability 無し): 通常攻撃 + 低 HP でたまに防御
  if (canGuard && r < 0.25) return 'guard';
  return 'attack';
}
