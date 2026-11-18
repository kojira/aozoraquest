/**
 * ボスの型 (pattern。D-ENDGAME-001 §B3r3・§B3m)。どの敵でも world.monsters のデータだけで持てる (敵ごとの分岐はない)。
 * - patternSets: HP の段 (below = 最大HP の割合。下回ったらその段へ。戻らない)。段ごとに 2〜3 通りの手の列 (weight つき)。
 * - 手の列は 1 巡ごとに、戦闘の乱数 (サーバーの turnSeed) で選びなおす。選んだ列は Combatant.pattern に持つ (edge は画面へ送らない)。
 * - tell: その手の 1 ターン前 (前のターンのおわり) にログへ出す前ぶれ。列がどれでも、つぎの手の tell が出る。
 * - 段が切りかわったら、その段の say をログに出し、新しい列のはじめから。
 * MP は使わない。1 人戦 (resolveTurn) と群れ (resolveTurnMulti) の両方がここを呼ぶ。
 */
import { BATTLE_TUNING } from './battle-tuning.js';
import { type Combatant } from './battle-combatant.js';
import { type MonsterDef, monsterHealAmount } from './battle-monsters.js';
import { type TurnEvent } from './battle-state.js';
import { doAttack } from './battle-attack.js';
import { applyIncomingCalc, applyStatus } from './statuses.js';
import { castMonsterSpell, useMonsterDebuff } from './battle-monster-moves.js';

export interface PatternStep {
  move: 'attack' | 'cast' | 'debuff' | 'heal' | 'strike' | 'smash' | 'drain';
  /** debuff: def.debuffs の番号。 */
  index?: number;
  /** strike: いつもの物理の式に掛ける倍率 (ため攻撃と同じ。守備・装備が効く)。target 'all' で全体。
   *  smash: 最大HP に対する割合 (守りの差が式で消える高い帯のボス用)。drain: 味方へのダメージ (amount) と自分の回復 (heal) の割合。 */
  power?: number;
  amount?: number;
  heal?: number;
  target?: 'one' | 'all';
  name?: string;
  /** drain を止めたときの 1 行 (ごほうびの守備↓ 2T のしらせ)。 */
  broken?: string;
  /** この手の前ぶれ (1 ターン前に出す)。大技には必ず付ける。手ごとにちがう文にする。 */
  tell?: string;
}
export interface BossPattern { weight: number; steps: readonly PatternStep[] }
export interface PatternSet {
  /** この段に入る HP の割合 (未満)。はじめの段は省略。 */
  below?: number;
  /** 段が切りかわったときの 1 行。 */
  say?: string;
  patterns: readonly BossPattern[];
}
/** 戦闘中の型の位置 (サーバーだけが持つ)。 */
export interface PatternCursor { set: number; pick: number; step: number; told: boolean }

const living = (arr: readonly Combatant[]) => arr.filter((c) => c.hp > 0);

function pickPattern(set: PatternSet, rng: () => number): number {
  const total = set.patterns.reduce((s, p) => s + p.weight, 0);
  let r = rng() * total;
  for (const [i, p] of set.patterns.entries()) { r -= p.weight; if (r < 0) return i; }
  return set.patterns.length - 1;
}
function setFor(def: MonsterDef, c: Combatant): number {
  const ratio = c.hp / c.maxHp; let k = 0;
  def.patternSets!.forEach((s, i) => { if (i > 0 && s.below !== undefined && ratio < s.below) k = i; });
  return k;
}
/** つぎに出る手 (まだ型に入っていなければ undefined)。 */
export function upcomingStep(def: MonsterDef | undefined, c: Combatant): PatternStep | undefined {
  const cur = c.pattern; if (!def?.patternSets?.length || !cur) return undefined;
  return def.patternSets[cur.set]!.patterns[cur.pick]!.steps[cur.step];
}
function ensureCursor(def: MonsterDef, c: Combatant, rng: () => number): PatternCursor {
  // はじめは必ずはじめの段から (段の切りかえは、ターンのおわりに say つきで行う)。
  if (!c.pattern) c.pattern = { set: 0, pick: pickPattern(def.patternSets![0]!, rng), step: 0, told: false };
  return c.pattern;
}

/** 型の 1 手を打つ。 */
export function patternAct(enemy: Combatant, def: MonsterDef, allies: readonly Combatant[], rng: () => number, events: TurnEvent[]): void {
  // 位置は毎回あたらしいオブジェクトにする (Combatant は浅いコピーなので、書きかえると前のターンの state まで動く)。
  const cur = ensureCursor(def, enemy, rng);
  const set = def.patternSets![cur.set]!;
  const st = set.patterns[cur.pick]!.steps[cur.step]!;
  const end = cur.step + 1 >= set.patterns[cur.pick]!.steps.length;
  enemy.pattern = { set: cur.set, pick: end ? pickPattern(set, rng) : cur.pick, step: end ? 0 : cur.step + 1, told: false };
  const to = { allies, one: () => { const l = living(allies); return l[Math.floor(rng() * l.length)]; } };
  const mp = enemy.mp;
  if (st.move === 'attack') { const tg = to.one(); if (tg) doAttack(enemy, tg, rng, events, 'monster'); }
  else if (st.move === 'cast' && def.spell) castMonsterSpell(enemy, def, to, rng, events);
  else if (st.move === 'debuff') useMonsterDebuff(enemy, def.debuffs![st.index ?? 0]!, allies, rng, events);
  else if (st.move === 'strike') {
    const targets = st.target === 'all' ? living(allies) : [to.one()].filter((c): c is Combatant => !!c);
    for (const tg of targets) { if (enemy.hp <= 0) break; doAttack(enemy, tg, rng, events, 'monster', { power: st.power ?? BATTLE_TUNING.chargedPower, hitBonus: -0.05, label: st.name ?? 'つよいこうげき' }); }
  } else if (st.move === 'heal') {
    const before = enemy.hp; enemy.hp = Math.min(enemy.maxHp, enemy.hp + monsterHealAmount(def, enemy.maxHp));
    events.push({ actor: 'monster', text: `${enemy.name}は${st.name ?? def.healName ?? 'きずをいやす'}! HPが${enemy.hp - before}回復。` });
  } else if (st.move === 'smash') {
    // 最大HP の割合で全体。ぼうぎょ・見切りで半分、守備↓・まもりのはが乗る。
    events.push({ actor: 'monster', text: `${enemy.name}の ${st.name ?? 'いちげき'}!` });
    for (const tg of living(allies)) {
      let dmg = tg.maxHp * (st.power ?? 0.9) * (0.95 + rng() * 0.1);
      if (tg.guarding || tg.parrying) dmg *= BATTLE_TUNING.guardReduction;
      dmg *= applyIncomingCalc(1, tg, { rng, events, actor: 'player' });
      const final = Math.max(1, Math.round(dmg)); tg.hp = Math.max(0, tg.hp - final);
      events.push({ actor: 'monster', text: `${tg.name}に${final}のダメージ${tg.hp === 0 ? '。' + tg.name + 'はちからつきた…!' : ''}`, damage: final, ...(tg.hp === 0 ? { fatal: true } : {}) });
    }
  } else if (st.move === 'drain') {
    // 前ぶれのあと弱点の属性で受けた量が drainBreak 以上なら止まる (ごほうびに守備↓ 2T)。
    if ((enemy.weakDmg ?? 0) >= (def.drainBreak ?? Infinity)) {
      events.push({ actor: 'monster', text: `${enemy.name}の ${st.name ?? 'すいこみ'}!` });
      events.push({ actor: 'monster', text: st.broken ?? 'しかし うまく いかなかった!' });
      applyStatus(enemy, { id: 'defDown', turns: 2 });
    } else {
      events.push({ actor: 'monster', text: `${enemy.name}の ${st.name ?? 'すいこみ'}!` });
      for (const tg of living(allies)) { const final = Math.max(1, Math.round(tg.maxHp * (st.amount ?? 0.25))); tg.hp = Math.max(0, tg.hp - final); events.push({ actor: 'monster', text: `${tg.name}に${final}のダメージ`, damage: final }); }
      const before = enemy.hp; enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(enemy.maxHp * (st.heal ?? 0)));
      events.push({ actor: 'monster', text: `${enemy.name}のHPが${enemy.hp - before}回復。` });
    }
  }
  enemy.mp = mp;
  enemy.lastAoe = false;
}

/** ターンのおわり: HP の段を見て切りかえ、つぎの手の前ぶれを出す。 */
export function patternEndOfTurn(enemy: Combatant, def: MonsterDef, rng: () => number, events: TurnEvent[]): void {
  if (enemy.hp <= 0) return;
  const cur = ensureCursor(def, enemy, rng);
  const want = setFor(def, enemy);
  if (want > cur.set) {
    const set = def.patternSets![want]!;
    enemy.pattern = { set: want, pick: pickPattern(set, rng), step: 0, told: false };
    if (set.say) events.push({ actor: 'monster', text: set.say });
  }
  const next = upcomingStep(def, enemy)!;
  if (enemy.pattern!.told) return;
  if (next.tell) {
    events.push({ actor: 'monster', text: next.tell });
    if (next.move === 'drain') enemy.weakDmg = 0;
  }
  enemy.pattern = { ...enemy.pattern!, told: true };
}

/** つぎの手が drain の敵は、ターンのいちばん最後に動く (ため と同じく、まる 1 ターン止めるすきを与える)。 */
export function actsLast(def: MonsterDef | undefined, c: Combatant): boolean {
  return upcomingStep(def, c)?.move === 'drain';
}
