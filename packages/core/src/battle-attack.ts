/**
 * 攻撃 1 回の解決 (物理 doAttack / 魔法 doMagic)。
 * (battle.ts から責務ごとに分割。公開 API は battle.ts から再エクスポート)
 */

import { elementMultiplier, type Element } from './elements.js';
import {
  type HookCtx,
  applyDodgeCalc,
  applyPowerCalc,
  applyCritCalc,
  applyIncomingCalc,
  applyOnHit,
  applyOnLethal,
  applyOnIncomingMagic,
  applyElementBonus,
  applyTargetBonus,
  applyOnDamaged,
  applyModifyHit,
  clearHitStatuses,
} from './statuses.js';
import { BATTLE_TUNING } from './battle-tuning.js';
import { type Combatant } from './battle-combatant.js';
import { type TurnEvent } from './battle-state.js';

export interface AttackOptions {
  /** 攻撃力の基準値を上書き (特技を支配ステータス基準にする: gamble=luk, flurry=agi)。
   *  素の atk が低い luk/agi 型ジョブでも「ジョブに合った能力」で火力が出るように。 */
  atkOverride?: number;
  /** ダメージ倍率 */
  power?: number;
  /** 命中補正 (負で外れやすく) */
  hitBonus?: number;
  /** 防御力に掛ける係数 (魔撃=0.5 で貫通気味に)。未指定は 1。 */
  defFactor?: number;
  /** int を攻撃力として使う (魔撃)。必中。 */
  useInt?: boolean;
  /** 技名 (テキストに使う)。無指定は通常攻撃 */
  label?: string;
  /** 攻撃属性 (#452 / docs/25 §1)。防御側の element と相性判定。未指定 (無属性) は等倍。 */
  element?: Element;
}

/** 攻撃 1 回の結果 (とくぎの inflict-on-hit 等が参照)。 */
export interface AttackResult {
  /** 命中したか (回避されたら false)。 */
  hit: boolean;
  /** 与えたダメージ (miss は 0)。 */
  damage: number;
  /** 対象を倒したか。 */
  fatal: boolean;
  /** 会心だったか。 */
  crit: boolean;
}

export function doAttack(
  attacker: Combatant,
  defender: Combatant,
  rng: () => number,
  events: TurnEvent[],
  actor: 'player' | 'monster',
  opts: AttackOptions = {},
): AttackResult {
  const t = BATTLE_TUNING;
  const label = opts.label ? `${attacker.name}の${opts.label}!` : `${attacker.name}のこうげき!`;
  // 状態異常/パッシブのフック文脈 (#452)。空 statuses なら applyXxx は入力そのまま = 従来挙動。
  const defenderSide: 'player' | 'monster' = actor === 'player' ? 'monster' : 'player';
  const atkCtx: HookCtx = { rng, events, actor };
  const defCtx: HookCtx = { rng, events, actor: defenderSide };

  // 回避判定 (魔撃は必中)。ぼうぎょの余韻 (focus) 中は「動きを読めている」ので回避が上がる。
  if (!opts.useInt) {
    const focusBonus = defender.focus > 0 ? t.guardFocusDodge : 0;
    // 命中補正 (accDown: 攻撃側の命中が下がる)。none なら opts.hitBonus のまま。
    const effHitBonus = applyModifyHit(opts.hitBonus ?? 0, attacker, atkCtx);
    let dodge = Math.min(
      t.dodgeMax + focusBonus,
      Math.max(t.dodgeMin, t.dodgeBase + (defender.agi - attacker.agi) * t.agiDodgeScale - effHitBonus + focusBonus),
    );
    dodge = applyDodgeCalc(dodge, defender, defCtx); // かくれみ/agi バフ
    if (rng() < dodge) {
      events.push({ actor, text: `${label} しかし ${defender.name}は身をかわした!` });
      return { hit: false, damage: 0, fatal: false, crit: false };
    }
  }

  // 命中確定後、即死パッシブ (首狩り等) の判定。none なら false。
  if (applyOnHit(attacker, defender, atkCtx)) {
    const killDmg = defender.hp;
    defender.hp = 0;
    clearHitStatuses(defender);
    events.push({ actor, text: `${label} ${defender.name}を一撃で仕留めた!`, damage: killDmg, fatal: true });
    return { hit: true, damage: killDmg, fatal: true, crit: false };
  }

  const atkValue = opts.atkOverride ?? (opts.useInt ? attacker.int : attacker.atk);
  const roll = 0.85 + rng() * 0.3;
  // クリティカル (luk)。会心は DQ のかいしんのいちげき流: **攻撃力 critAtkMultiplier 倍**。
  // **守備力 (def) 無視はプレイヤーの会心のみ** (守備の高い敵を貫く一発逆転
  // 2026-07-20)。敵の会心を守備無視にすると、タンク職 (guardian) の「固く受ける」存在意義が
  // 壊れ拮抗帯で事故死が倍増するため、敵の会心は 1.5 倍のみ (バランス ★★★)。ぼうぎょ/見切り
  // **コマンドの半減はどちらも貫通しない** — 貫くと「予告を見て防御」の読み合いが崩れる (設計 ★★★)。
  const crit = applyCritCalc(rng() < t.critBase + attacker.luk * t.critLukScale, attacker, atkCtx); // 九字切り=確定会心
  const critAtk = crit ? t.critAtkMultiplier : 1;
  const defValue = crit && actor === 'player' ? 0 : defender.def * (opts.defFactor ?? 1);
  // DQ の減算式 (攻撃÷2 − 防御÷4) 流: **防御の係数 (defCoef) を攻撃の半分 (2:1)** にしてインフレを
  // 抑える。高守備の敵 (メタル) は atkTerm−defTerm が負に沈み minDamage
  // しか通らず、会心 (defValue=0) のみ貫通できる = 専用ロジック不要で「守備が硬い」が表現される。
  // 攻撃威力バフ (atkUp/atkDown)。none なら ×1。
  const atkTerm = atkValue * t.atkCoef * critAtk * (opts.power ?? 1) * applyPowerCalc(1, attacker, atkCtx);
  // **かすりの床は減算の段階で入れる** (乗算補正より前)。後ろで max を取ると、ぼうぎょ半減・
  // 属性耐性・被ダメ軽減パッシブが 0 沈み域で丸ごと無効になり、**ぼうぎょすると被ダメが増える**
  // 逆転すら起きる (実測 66 通り。例: ぬまの大蛇 atk15 vs def28 → 素受け 1 / ぼうぎょ 2)。
  // ここに置けば従来どおり全部が乗算され、ironDef の 0 も維持される。
  const floor = defender.ironDef ? t.minDamage : atkValue * t.scratchRatio;
  let dmg = Math.max(floor, atkTerm - defValue * t.defCoef) * roll;

  // 防御 / 見切りで半減 (会心でもコマンド防御は効く = 防御の存在意義を守る)
  if (defender.guarding || defender.parrying) dmg *= t.guardReduction;
  // 被ダメバフ (defUp/defDown/転倒)。none なら ×1。
  dmg *= applyIncomingCalc(1, defender, defCtx);
  // 属性相性 (#452 §1): 攻撃属性 × 防御属性。両者 undefined (無属性) なら ×1 = 従来挙動。
  // モンスター/装備への属性付与は #455/#456 で配線。慧眼 (賢者) は弱点時さらに増幅 (none なら素通し)。
  dmg *= applyElementBonus(elementMultiplier(opts.element, defender.element), attacker, atkCtx);
  // 対象状態シナジー: 審美眼 (芸術家) は状態異常の敵に与ダメ↑ (none なら素通し)。
  dmg *= applyTargetBonus(1, attacker, defender, atkCtx);

  // **ダメージ 0 は正当な結果**。守備力を上回れなければ 1 も通らない
  // = メタル系が「かいしんのいちげき (守備無視) でしか倒せない」identity を持てる。以前は
  // 最低 1 を保証していたため、atk 1 の魔法使いでも殴り続ければメタルを削り切れてしまっていた。
  //
  // ただし **0 が許されるのは ironDef (メタル系) だけ**。床は上の減算の段階で入れてある。
  const final = Math.max(0, Math.round(dmg));
  // 物理致死の直前に onLethal フック (覇王/不動) を確認。survive なら HP1 で耐える (反射等は
  // ハンドラ内で処理済み)。魔法致死は doMagic を通るためここには来ず、耐えられず死ぬ (§12)。
  if (defender.hp - final <= 0 && applyOnLethal(defender, attacker, final, defCtx)) {
    defender.hp = 1;
  } else {
    defender.hp = Math.max(0, defender.hp - final);
  }
  const fatal = defender.hp === 0;
  // 被弾で解ける状態 (かくれみ解除・眠り起床)。none なら no-op。
  if (!fatal) clearHitStatuses(defender);
  // 決着文はプレイヤー視点: 敵を倒した =「◯◯をたおした!」、自分が倒れた =
  // 「◯◯はちからつきた!」(プレイヤーが「たおされる」対象になる文は視点が転倒する)。
  const fatalText = fatal
    ? actor === 'player'
      ? `。${defender.name}をたおした!`
      : `。${defender.name}はちからつきた…!`
    : '';
  events.push({
    actor,
    text: `${label}${crit ? ' 会心の一撃!!' : ''} ${defender.name}に ${final} のダメージ${fatalText}`,
    damage: final,
    ...(fatal ? { fatal: true } : {}),
  });
  const result: AttackResult = { hit: true, damage: final, fatal, crit };

  // 被弾後フック (とげの盾: 攻撃者へ反射)。倒れていなければ。none なら no-op。
  if (!fatal) applyOnDamaged(defender, attacker, final, defCtx);

  // 見切り反撃 (倒れていなければ)
  if (!fatal && defender.parrying) {
    defender.parrying = false;
    const counterActor = actor === 'player' ? 'monster' : 'player';
    // 反撃は支配ステータス (def) 基準 — 守りの固さがそのまま反撃の重さになる
    // (見切り職は atk が低く、atk 基準だと tier3 で火力が出ずジリ貧になる)
    doAttack(defender, attacker, rng, events, counterActor, { power: 0.75, atkOverride: defender.def, label: 'はんげき' });
  }
  return result;
}

/**
 * 魔法ダメージ (#456 / docs/25 §14.6・§423)。**範囲ベース・必中・def 無視** (DQ 流)。
 * `amount` は呼び出し側 (とくぎ) が範囲 roll + int 連動で算出済みの生ダメージ。ここで
 * **属性相性 (§1) と被ダメバフ (defUp/defDown)** を掛けて確定・適用する。会心・回避・反撃なし。
 * 物理 (doAttack) と違い defender の def を一切見ないため、守備の高い敵にも通る (メタルの魔法無効は
 * #455 で monster resist として別途)。
 */
export function doMagic(
  attacker: Combatant,
  defender: Combatant,
  rng: () => number,
  events: TurnEvent[],
  actor: 'player' | 'monster',
  opts: { amount: number; element?: Element; label?: string },
): AttackResult {
  const label = opts.label ? `${attacker.name}の${opts.label}!` : `${attacker.name}の魔法!`;
  const defenderSide: 'player' | 'monster' = actor === 'player' ? 'monster' : 'player';
  const defCtx: HookCtx = { rng, events, actor: defenderSide };
  const atkCtx: HookCtx = { rng, events, actor };
  let dmg = opts.amount;
  // 属性相性 (無属性は ×1)。慧眼 (賢者) は弱点時さらに増幅 (none なら素通し)。
  const eMult = applyElementBonus(elementMultiplier(opts.element, defender.element), attacker, atkCtx);
  dmg *= eMult;
  dmg *= applyTargetBonus(1, attacker, defender, atkCtx); // 審美眼: 状態異常の敵に与ダメ↑ (none 素通し)
  dmg *= applyIncomingCalc(1, defender, defCtx); // defUp/defDown/転倒
  // メタル系の魔法無効 (#455 / DQ 準拠): def 無視の魔法でも最小 1 に抑える (会心物理でしか倒せない)。
  // resistAllMagic (メタル系) は魔法を **完全無効 = 0**。物理と同じく「通らない」を表現する。
  const final = defender.resistAllMagic ? 0 : Math.max(0, Math.round(dmg));
  // 清き心 (聖騎士): 低確率で魔法反射 (被弾側フック)。reflect なら被弾 0・術者へ跳ね返し済み (ハンドラ内)。
  // 被弾 0 なので clearHitStatuses (かくれみ/眠り解除) も弱点告知も出さないのが正 (被弾していない扱い)。
  // 将来の見切り (魔法ミス化=回避) も同じ「被弾 0」結果なので、必要なら返り値に nullify を足して分岐する。
  if (!defender.resistAllMagic && applyOnIncomingMagic(defender, attacker, final, defCtx)) {
    return { hit: true, damage: 0, fatal: false, crit: false };
  }
  defender.hp = Math.max(0, defender.hp - final);
  const fatal = defender.hp === 0;
  if (!fatal) clearHitStatuses(defender); // 被弾で解ける状態 (かくれみ/眠り)
  const fatalText = fatal
    ? actor === 'player'
      ? `。${defender.name}をたおした!`
      : `。${defender.name}はちからつきた…!`
    : '';
  events.push({
    actor,
    text: `${label} ${defender.name}に ${final} のダメージ${fatalText}`,
    damage: final,
    ...(fatal ? { fatal: true } : {}),
  });
  // 属性相性のフィードバック (DQ 流)。弱点=1.5 / 耐性=0.5 のみ告知 (空の 1.2 は普遍なので出さない)。
  // 撃破時も出す (弱点を突いて倒した実感)。メタルの魔法無効時は出さず「効かない」を数値 1 で伝える。
  if (!defender.resistAllMagic) {
    if (eMult >= 1.5) events.push({ actor, text: `${defender.name}の弱点を突いた!` });
    else if (eMult <= 0.5) events.push({ actor, text: `${defender.name}には 効果がいまひとつのようだ…` });
  }
  return { hit: true, damage: final, fatal, crit: false };
}
