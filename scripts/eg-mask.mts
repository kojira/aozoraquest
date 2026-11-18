/** D-ENDGAME-001 §B3r3・§B3m: 型のあるボス (patternSets) の連戦を回す。決戦 (mask-1+mask-2) も章のボスもこれ。
 * MODE=P 前ぶれと見える状態だけで読む / PM いちばん多い列を暗記して前ぶれを見ない / N いまの自動 (仲間は おまかせ) / PH 主人公だけ読む。
 * 装備は本物の品 (ITEMS_JSON の world.items) から、職ごとに その grade の 1 式 (scripts/eg-gear.mts)。
 * env: MONSTERS_JSON ITEMS_JSON BOSSES=mask-1,mask-2 (省略は BOSS=json の MonsterDef[]) LV G HLV HG PARTY=warrior,mage,miko N DYE SKIP=guard,reflect,cleanse,burst ITEMS JOBS PER */
/** D-ENDGAME-001 r3: 決戦の型 (patternSets・ランダムな列・HP の段) を回す。/tmp だけ。
 * MODE=P 前ぶれと見える状態だけで読む / PM いちばん多い列を暗記して前ぶれを見ない / N いまの自動 / PH 主人公だけ読む。
 * env: BOSS=json(MonsterDef[]) LV G HLV HG PARTY=warrior,mage,miko N DYE SKIP=guard,reflect,cleanse,burst ITEMS */
import { core, median, minOf } from './sim-party-lib.mts';
import { bestGearFor } from './eg-gear.mts';
const N = Number(process.env.N ?? 100);
const bosses = process.env.BOSS ? core.decodeMonstersFromRecord(JSON.parse(process.env.BOSS)) : (process.env.BOSSES ?? 'mask-1,mask-2').split(',').map((id) => core.MONSTERS_BY_ID[id]!);
if (process.env.BOSS) core.setMonsterOverrides([...core.MONSTERS.filter((m) => !bosses.some((b) => b.id === m.id)), ...bosses] as never);
const gearOf = (job: string, g: number) => bestGearFor(core, job as never, g, process.env.DYE ? { dye: process.env.DYE } : {});
const LV = Number(process.env.LV ?? 26), G = Number(process.env.G ?? 6), HLV = Number(process.env.HLV ?? LV), HG = Number(process.env.HG ?? G);
const MATES = (process.env.PARTY ?? 'warrior,mage,miko').split(',').filter(Boolean) as never[];
const MODE = process.env.MODE ?? 'P';
const LINE = Number(process.env.LINE ?? 0.7);
/** (P) から外す読み (どれを読まないと負けるかを測る): guard,reflect,burst,cleanse */
const SKIP = new Set((process.env.SKIP ?? '').split(',').filter(Boolean));
const ITEMS: Record<string, number> = JSON.parse(process.env.ITEMS ?? '{"mezamashi-suzu":2,"holy-water":2,"mizu-deppou":3,"hi-no-tama":3}');
const { SKILLS } = core;
type S = import('../packages/core/src/index.js').BattleState; type C = import('../packages/core/src/index.js').Combatant;
const has = (c: C, id: string) => (c.statuses ?? []).some((s) => s.id === id);
const BAD = ['atkDown', 'defDown', 'accDown'];
const skillsOf = (c: C, s: S, i: number) => (i === 0 ? s.playerSkills : core.skillsForJob(c.job!.archetype, c.job!.level));
/** その手の見こみダメージ (ざっくり)。magic=呪文 (反射で返る)、phys=物理 (とげで返る)。 */
function estimate(kind: string, c: C, boss: C, weak: string | undefined) {
  const d = SKILLS[kind]; if (!d) return { dmg: 0, magic: false };
  let dmg = 0, magic = false;
  for (const e of d.effects as any[]) {
    if (e.kind === 'fixedDamage') { magic = true; let a = (e.min + e.max) / 2 + c.int * (e.intBonus ?? 0) + c.luk * (e.luckScale ?? 0); a *= core.elementMultiplier(e.element, boss.element); dmg += a * (e.target === 'allEnemies' ? 1 : 1); }
    if (e.kind === 'damage') { const st = e.stat === 'int' ? c.int : e.stat === 'agi' ? c.agi : e.stat === 'luk' ? c.luk : e.stat === 'def' ? c.def : c.atk; const p = (e.power ?? 1) * (e.gamble ? 1.3 : 1);
      dmg += (e.hits ?? 1) * Math.max(st * 0.25, st * 0.9 * p - boss.def * 0.45 * (e.defFactor ?? 1)) * (e.element ? core.elementMultiplier(e.element, boss.element) : 1); }
  }
  return { dmg, magic };
}
const isWeak = (k: string, boss: C) => !!SKILLS[k]?.effects.some((e: any) => (e.kind === 'fixedDamage' || e.kind === 'damage') && e.element && core.elementMultiplier(e.element, boss.element) > 1);
function bestHit(c: C, s: S, i: number, boss: C, allowMagic: boolean, allowPhys: boolean, weakOnly = false) {
  const cost = core.skillMpCostOf(c); const sk = skillsOf(c, s, i);
  const plain = Math.max(c.atk * 0.25, c.atk * 0.9 - boss.def * 0.45) * (c.weaponElement ? core.elementMultiplier(c.weaponElement, boss.element) : 1);
  let best: { command: 'attack' | 'skill' | 'guard'; skillIndex: number; dmg: number } = allowPhys ? { command: 'attack', skillIndex: 0, dmg: plain } : { command: 'guard', skillIndex: 0, dmg: 0 };
  if (c.mp >= cost) sk.forEach((k, j) => { const e = estimate(k.kind, c, boss, undefined); if (e.dmg <= 0) return; if (e.magic ? !allowMagic : !allowPhys) return;
    const w = weakOnly ? (isWeak(k.kind, boss) ? e.dmg : 0) : e.dmg; if (w > best.dmg * 1.15) best = { command: 'skill', skillIndex: j, dmg: w }; });
  if (weakOnly && best.command === 'attack' && !(c.weaponElement && core.elementMultiplier(c.weaponElement, boss.element) > 1)) best.dmg = 0;
  return best;
}
const healRatio = (k: string) => Math.max(0, ...(SKILLS[k]?.effects ?? []).map((e: any) => (e.kind === 'heal' ? e.ratio : 0)));
/** 条件に合うとくぎのうち、回復量のいちばん大きいもの (回復でなければ先頭)。 */
const findSkill = (c: C, s: S, i: number, pred: (k: string) => boolean) => { if (c.mp < core.skillMpCostOf(c)) return -1; const sk = skillsOf(c, s, i); let b = -1; sk.forEach((k, j) => { if (pred(k.kind) && (b < 0 || healRatio(k.kind) > healRatio(sk[b]!.kind))) b = j; }); return b; };
const isCleanse = (k: string) => !!SKILLS[k]?.effects.some((e: any) => e.kind === 'cleanse' && e.target === 'allAllies');
const isAllHeal = (k: string) => !!SKILLS[k]?.effects.some((e: any) => e.kind === 'heal' && e.target === 'allAllies');
const isOneHeal = (k: string) => !!SKILLS[k]?.effects.some((e: any) => e.kind === 'heal' && e.target === 'oneAlly');
const isParry = (k: string) => !!SKILLS[k]?.parry;
type Order = { command: any; skillIndex: number; targetIndex: number; itemId?: string };
type Step = import('../packages/core/src/index.js').PatternStep;
/** 前ぶれの文 → 手。負けてログを見る・宿のヒントで覚える「文の意味」で、どの列が選ばれたかは見ない。 */
const TELLS = new Map<string, Step>();
for (const d of bosses) for (const ps of d.patternSets ?? []) for (const p of ps.patterns) for (const st of p.steps) if (st.tell) TELLS.set(st.tell, st);
/** (P) つぎの手 = 前のターンのログに出た前ぶれ (無ければ小さい手)。 */
const toldNext = (s: S): Step | undefined => { for (const e of s.lastEvents) { const st = TELLS.get(e.text); if (st) return st; } return undefined; };
/** (PM) 暗記: はじめの段のいちばん重い列を、段のはじめから決まった順でくりかえすと思いこむ。前ぶれは見ない。 */
const memo = { k: 0 };
const memorisedNext = (s: S, boss: C): Step => { const def = core.MONSTERS_BY_ID[boss.monsterId!]!; const set = def.patternSets![0]!;
  const p = [...set.patterns].sort((a, b) => b.weight - a.weight)[0]!; return p.steps[memo.k % p.steps.length]!; };
/** (P) 型を読む手: 前ぶれ (つぎの手) と仮面の状態だけを見て、4人の手を決める。 */
function planP(s: S, memorise = false): Order[] {
  const allies = s.allies!; const boss = s.enemies!.find((e) => e.hp > 0)!; const def = core.MONSTERS_BY_ID[boss.monsterId!]!;
  const next = memorise ? memorisedNext(s, boss) : toldNext(s);
  const nextSelf = next?.move === 'debuff' ? def.debuffs![next.index ?? 0]!.status : undefined;
  const reflect = !SKIP.has('reflect') && (has(boss, 'magicReflect') || nextSelf === 'magicReflect'), thorns = !SKIP.has('reflect') && (has(boss, 'thorns') || nextSelf === 'thorns');
  const living = allies.filter((a) => a.hp > 0);
  const out: Order[] = allies.map(() => ({ command: 'guard', skillIndex: 0, targetIndex: 0 }));
  let items = { ...(s.battleItems ?? {}) }; let herbs = s.herbs;
  const take = (id: string) => (items[id] ?? 0) > 0 ? (items[id]!--, true) : false;
  const done = new Set<number>();
  const hurtAll = living.filter((a) => a.hp < a.maxHp * 0.55).length;
  const debuffed = !SKIP.has('cleanse') && living.some((a) => BAD.some((b) => has(a, b)));
  // 1) 弱体を消す (つぎの大技の前に)
  if (debuffed) { const m = allies.findIndex((a, i) => a.hp > 0 && findSkill(a, s, i, isCleanse) >= 0);
    if (m >= 0) { out[m] = { command: 'skill', skillIndex: findSkill(allies[m]!, s, m, isCleanse), targetIndex: 0 }; done.add(m); }
    else if (take('mezamashi-suzu')) { out[0] = { command: 'item', skillIndex: 0, targetIndex: 0, itemId: 'mezamashi-suzu' }; done.add(0); } }
  // 2) 大技の予告: みんな ぼうぎょ (見切りがあれば見切り)
  if ((next?.move === 'smash' || next?.move === 'strike') && !SKIP.has('guard')) { allies.forEach((a, i) => { if (done.has(i) || a.hp <= 0) return; const p = findSkill(a, s, i, isParry); out[i] = p >= 0 ? { command: 'skill', skillIndex: p, targetIndex: 0 } : { command: 'guard', skillIndex: 0, targetIndex: 0 }; done.add(i); }); return out; }
  // 3) 回復。つぎのつぎは分からないので、大技に耐えられる線 (LINE) を保つ。
  // 吸う前のターンは、みんなで一気に削る (止めの基準を超える)。回復は倒れそうな人だけ。
  const burst = next?.move === 'drain' && !SKIP.has('burst');
  const line = burst ? 0.25 : LINE;
  const hurtN = living.filter((a) => a.hp < a.maxHp * line).length;
  if (hurtN >= 2) { const m = allies.findIndex((a, i) => a.hp > 0 && !done.has(i) && findSkill(a, s, i, isAllHeal) >= 0);
    if (m >= 0) { out[m] = { command: 'skill', skillIndex: findSkill(allies[m]!, s, m, isAllHeal), targetIndex: 0 }; done.add(m); }
    else if (!done.has(0) && take('holy-water')) { out[0] = { command: 'item', skillIndex: 0, targetIndex: 0, itemId: 'holy-water' }; done.add(0); } }
  allies.forEach((a, i) => { if (done.has(i) || a.hp <= 0) return; if (a.hp < a.maxHp * (burst ? 0.25 : LINE - 0.1)) {
    const h = findSkill(a, s, i, isOneHeal); if (h >= 0) { out[i] = { command: 'skill', skillIndex: h, targetIndex: living.indexOf(a) }; done.add(i); return; }
    if (i === 0 && herbs > 0) { herbs--; out[i] = { command: 'herb', skillIndex: 0, targetIndex: 0 }; done.add(i); } } });
  // 4) 攻める: 反射なら物理だけ、とげなら呪文だけ (どちらも無ければ ぼうぎょ)
  allies.forEach((a, i) => { if (done.has(i) || a.hp <= 0) return; const b0 = bestHit(a, s, i, boss, !reflect, !thorns, burst); const b = burst && b0.dmg <= 0 ? bestHit(a, s, i, boss, !reflect, !thorns) : b0;
    // 物理も呪文もだめなら、弱点の属性のどうぐ (反射の間は使わない)。
    // 属性のどうぐ: 吸う前のターン (burst) にまとめて使う。読まない人は、空いた手で先に使ってしまう。
    if ((burst ? b0.dmg <= 0 : SKIP.has('burst') ? b.command !== 'skill' || b.dmg < 150 : b.command === 'guard') && !reflect) { const el = Object.keys(items).find((id) => (items[id] ?? 0) > 0 && core.ITEMS[id]?.battle?.effects.some((e: any) => e.kind === 'fixedDamage' && core.elementMultiplier(e.element, boss.element) > 1));
      if (el) { items[el]!--; out[i] = { command: 'item', skillIndex: 0, targetIndex: 0, itemId: el }; return; } }
    out[i] = { command: b.command, skillIndex: b.skillIndex, targetIndex: 0 }; });
  return out;
}
/** (N) いまの自動: 主人公は sim-party-lib と同じ (1対1の先読み・やくそう・ためなら防御・空いた手でどうぐ)、仲間は おまかせ。 */
function heroN(s: S): Order {
  const boss = s.enemies!.find((e) => e.hp > 0)!; const reflecting = has(boss, 'magicReflect');
  const item = Object.entries(s.battleItems ?? {}).find(([id, n]) => n > 0 && !(reflecting && core.ITEMS[id]?.battle?.effects.some((e: any) => e.kind === 'fixedDamage')))?.[0];
  const hurt = s.herbs > 0 && s.player.hp < s.player.maxHp * 0.45;
  if (item && !hurt && !boss.charging && (item !== 'holy-water' || s.allies!.filter((a) => a.hp > 0 && a.hp < a.maxHp * 0.5).length >= 2) && (item !== 'mezamashi-suzu' || s.allies!.some((a) => BAD.some((b) => has(a, b))))) return { command: 'item', skillIndex: 0, targetIndex: 0, itemId: item };
  const view = { ...s, monster: boss } as S; delete view.allies; delete view.enemies;
  const a = core.autoBattleAction(view);
  return { command: a.command, skillIndex: a.skillIndex, targetIndex: 0 };
}
const LOSS: Record<string, number> = {};
function run(job: string, seed: number) {
  let carry: any; let turns = 0;
  for (const [k, def] of bosses.entries()) { memo.k = 0;
    let s: S = core.startBattle(job as never, HLV, 1, 'hero', def.tier as never, (seed * 2654435761 + k) >>> 0, carry?.herbs ?? 2, carry ? { hp: carry.hp, mp: carry.mp } : undefined,
      { tonics: carry?.tonics ?? 2, vitalsVariance: 0, gear: gearOf(job, HG) as never, monsterId: def.id, story: { canFlee: false }, battleItems: carry?.items ?? { ...ITEMS } } as never);
    const defs = MATES.map((a, i) => ({ id: `m${i}`, name: `mate${i}`, archetype: a, level: LV, gear: gearOf(a, G) }));
    const members = core.partyMembers(defs as never, LV, carry ? { hp: carry.mates, mp: carry.matesMp } : {});
    s = { ...s, allies: [s.player, ...members.map((m) => m.combatant)], enemies: s.enemies ?? [s.monster], ...(MODE === 'NI' || MODE === 'PHI' ? { allyModes: [undefined, ...members.map(() => 'inochi')] } : {}) } as S;
    for (let i = 0; i < 60 && s.outcome === 'ongoing'; i++) { turns++;
      if (MODE === 'P' || MODE === 'PM') { const o = planP(s, MODE === 'PM'); memo.k++; const h = o[0]!; s = core.resolveTurnMulti(s, h.command, undefined, h.skillIndex, h.targetIndex, h.itemId, [undefined, ...o.slice(1)] as never); }
      else if (MODE === 'PH' || MODE === 'PHI') { const h = planP(s)[0]!; s = core.resolveTurnMulti(s, h.command, undefined, h.skillIndex, h.targetIndex, h.itemId); }
      else { const h = heroN(s); s = core.resolveTurnMulti(s, h.command, undefined, h.skillIndex, h.targetIndex, h.itemId); }
      if (process.env.TRACE) { const b = s.enemies![0]!; console.log(`   [cursor ${JSON.stringify(b.pattern)}]`); }
      if (process.env.TRACE) { console.log(`-- T${i + 1} boss ${s.enemies![0]!.hp}/${s.enemies![0]!.maxHp} | ` + s.allies!.map((a) => `${a.hp}/${a.maxHp}`).join(' ')); for (const e of s.lastEvents) console.log('   ' + e.text); }
    }
    if (s.outcome !== 'win') { if (process.env.LOSS) { const b = s.enemies![0]!; const key = `k${k} set${b.pattern?.set} hp${Math.round((b.hp / b.maxHp) * 10)}`; LOSS[key] = (LOSS[key] ?? 0) + 1; } return { win: false, turns }; }
    const mates: any = {}, matesMp: any = {}; members.forEach((m, i) => { mates[m.id] = s.allies![i + 1]!.hp; matesMp[m.id] = s.allies![i + 1]!.mp; });
    carry = { hp: s.player.hp, mp: s.player.mp, herbs: 2, tonics: s.tonics, items: s.battleItems, mates, matesMp };
  }
  return { win: true, turns };
}
if (process.env.TRACE) { console.log(JSON.stringify(run(process.env.TRACE, Number(process.env.SEED ?? 1)))); process.exit(0); }
if (process.env.DBG) console.log(JSON.stringify(run("mage", 3)));
const wins: number[] = [], tt: number[] = [], per: string[] = [];
const jobs = process.env.JOBS ? process.env.JOBS.split(',') : core.ARCHETYPES;
for (const job of jobs) { let w = 0, t = 0; for (let sd = 0; sd < N; sd++) { const r = run(job, sd + 1); if (r.win) { w++; t += r.turns; } } wins.push((w / N) * 100); tt.push(w ? t / w : 0); per.push(`${job}:${Math.round((w / N) * 100)}`); }
console.log(`${MODE} hero Lv${HLV}/g${HG} mates ${MATES.join('+') || '-'} Lv${LV}/g${G}: min ${minOf(wins).toFixed(0)} med ${median(wins).toFixed(0)} | T ${(median(tt.filter((x) => x > 0)) ?? 0).toFixed(1)}${process.env.PER ? '\n  ' + per.join(' ') : ''}`);
if (process.env.LOSS) console.log(JSON.stringify(Object.entries(LOSS).sort((a, b) => b[1] - a[1]).slice(0, 8)));
