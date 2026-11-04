/**
 * フィールドの回復 (D-PARTY-003)。どれもサーバーが確かめて権威 state の持ちこし HP/MP を書く。
 * - やくそう / そらのしずく (`POST /api/world/item`): 主人公か仲間 1 人 (target) に。
 * - 回復のとくぎ (`POST /api/world/skill`): 主人公か、その Lv で回復のとくぎを覚えている仲間が、選んだ相手 (全体回復は全員) に唱える。
 *   MP は唱えた人の持ちこしから。回復量は戦闘と同じ (相手の maxHp の割合)。同じ rkey の再送は 1 回だけ。
 * 主人公の持ちこしは carryHp/carryMp、仲間は party.hp[id]/party.mp[id] (満タンは書かない)。最大 HP/MP は戦闘と同じ組み立て方。
 * 倒れた仲間 (HP 0) は回復できない (生き返らせるのは入れていない)。
 */
import {
  BATTLE_TUNING, SKILLS, effectTarget, healAmount, isPureHealSkill, jobLevelFromXp, partyDefsOf, partyMemberCombatant, playerCombatant, playerLevelFromXp, recruitById, skillMpCostOf, skillsForJob,
  type Combatant,
} from '@aozoraquest/core';
import { readModifyWrite, readState, type GameState } from './game-state';
import { DEFAULT_NS, ResolverError, jobXpOf, migrateInitState, readDiagnosis, type ResolverEnv } from './battle-resolver';
import { MAX_SHOP_OPS } from './shop';

/** 回復の相手。主人公は 'hero'、仲間は party の id。 */
export const HERO_TARGET = 'hero';

interface Member { id: string; c: Combatant }

/** 主人公と仲間 (入れている順) を、持ちこしの HP/MP つきで。 */
function membersOf(state: GameState, hero: Combatant, jobLevel: number): Member[] {
  const h = { ...hero, hp: state.carryHp ?? hero.maxHp, mp: state.carryMp ?? hero.maxMp };
  const carry = { ...(state.party?.hp ? { hp: state.party.hp } : {}), ...(state.party?.mp ? { mp: state.party.mp } : {}) };
  return [{ id: HERO_TARGET, c: h }, ...partyDefsOf(state.party, recruitById, jobLevel).map((d) => ({ id: d.id, c: partyMemberCombatant(d, jobLevel, carry) }))];
}

/** 持ちこしを書き戻す (満タンは消す)。 */
function withVitals(state: GameState, id: string, c: Combatant): GameState {
  const hp = c.hp >= c.maxHp ? undefined : c.hp;
  const mp = c.mp >= c.maxMp ? undefined : c.mp;
  if (id === HERO_TARGET) return { ...state, carryHp: hp, carryMp: mp };
  const party = state.party ?? { ids: [] };
  const hps = { ...party.hp }, mps = { ...party.mp };
  if (hp === undefined) delete hps[id]; else hps[id] = hp;
  if (mp === undefined) delete mps[id]; else mps[id] = mp;
  const { hp: _h, mp: _m, ...rest } = party;
  return { ...state, party: { ...rest, ...(Object.keys(hps).length ? { hp: hps } : {}), ...(Object.keys(mps).length ? { mp: mps } : {}) } };
}

function pick(members: Member[], id: string | undefined, what: string): Member {
  const m = members.find((x) => x.id === (id ?? HERO_TARGET));
  if (!m) throw new ResolverError(`${what}が パーティに いない`, 400, 'bad_target');
  return m;
}

async function heroOf(userDid: string, state: GameState, ns: string, fetchImpl?: typeof fetch) {
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const jobLevel = jobLevelFromXp(jobXpOf(state, archetype), archetype);
  return { hero: { ...playerCombatant(archetype, jobLevel, playerLevelFromXp(playerXp), handle, baseStats, undefined, state.gearSel), job: { archetype, level: jobLevel } }, jobLevel };
}

export interface ItemResult {
  carryHp?: number;
  carryMp?: number;
  materials: Record<string, number>;
  healed: number;
  /** 仲間に使ったときの、仲間の持ちこし (満タンは無い)。 */
  party?: GameState['party'];
}

/** フィールドの道具使用 (やくそう=herb / そらのしずく=tonic)。サーバー在庫を 1 消費して、相手の持ちこし HP/MP を回復。
 *  target は 'hero' (省略時) か仲間の id。満タン/在庫切れ/倒れた仲間は 400。 */
export async function handleItem(env: ResolverEnv, userDid: string, item: 'herb' | 'tonic', now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch, target?: string): Promise<ItemResult> {
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const matId = item === 'herb' ? 'herb' : 'sky-dew';
  if ((state.materials[matId] ?? 0) <= 0) throw new ResolverError(item === 'herb' ? 'やくそうを もっていない' : 'そらのしずくを もっていない', 400);
  const { hero, jobLevel } = await heroOf(userDid, state, ns, fetchImpl);
  let healed = 0;
  const written = await readModifyWrite(env, userDid, (cur) => {
    const have = cur.materials[matId] ?? 0;
    if (have <= 0) throw new ResolverError('在庫切れ', 400);
    const to = pick(membersOf(cur, hero, jobLevel), target, 'つかう相手');
    const c = { ...to.c };
    if (c.hp <= 0) throw new ResolverError(`${c.name}は たおれている`, 400, 'target_down');
    const m = { ...cur.materials, [matId]: have - 1 };
    if ((m[matId] ?? 0) <= 0) delete m[matId];
    if (item === 'herb') {
      if (c.hp >= c.maxHp) throw new ResolverError('HP は満タン', 400);
      const hp = Math.min(c.maxHp, c.hp + Math.round(c.maxHp * BATTLE_TUNING.herbHealRatio));
      healed = hp - c.hp;
      c.hp = hp;
    } else {
      if (c.mp >= c.maxMp) throw new ResolverError('MP は満タン', 400);
      const mp = Math.min(c.maxMp, c.mp + Math.max(1, Math.round(c.maxMp * BATTLE_TUNING.tonicMpRatio)));
      healed = mp - c.mp;
      c.mp = mp;
    }
    return { ...withVitals(cur, to.id, c), materials: m };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { carryHp: written.carryHp, carryMp: written.carryMp, materials: written.materials, healed, ...(written.party ? { party: written.party } : {}) };
}

export interface SkillResult {
  /** 回復した人ごとの量 (相手を選ぶとくぎは 1 人)。 */
  healed: Array<{ id: string; name: string; amount: number }>;
  casterName: string;
  skillName: string;
  carryHp?: number;
  carryMp?: number;
  party?: GameState['party'];
  /** 同じ rkey の再送だったか。 */
  duplicate?: boolean;
}

/** フィールドで回復のとくぎを唱える (`POST /api/world/skill`)。caster / target は 'hero' か仲間の id。全体回復は target 不要。 */
export async function handleFieldSkill(
  env: ResolverEnv, userDid: string, input: { caster?: unknown; skillId?: unknown; target?: unknown; rkey?: unknown }, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch,
): Promise<SkillResult> {
  const { caster, skillId, target, rkey } = input;
  if (typeof rkey !== 'string' || !rkey || rkey.length > 128) throw new ResolverError('rkey が不正', 400, 'bad_request');
  if (typeof skillId !== 'string' || (caster !== undefined && typeof caster !== 'string') || (target !== undefined && typeof target !== 'string')) throw new ResolverError('入力が不正', 400, 'bad_request');
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const { hero, jobLevel } = await heroOf(userDid, state, ns, fetchImpl);
  const op = `skill:${rkey}`;
  let result: Omit<SkillResult, 'carryHp' | 'carryMp' | 'party'> = { healed: [], casterName: '', skillName: '' };
  const written = await readModifyWrite(env, userDid, (cur) => {
    if ((cur.shopOps ?? []).includes(op)) { result = { ...result, duplicate: true }; return cur; }
    const members = membersOf(cur, hero, jobLevel);
    const from = pick(members, caster, 'となえる人');
    const job = from.c.job!;
    const skill = skillsForJob(job.archetype, job.level).find((k) => k.kind === skillId);
    if (!skill) throw new ResolverError(`${from.c.name}は そのとくぎを おぼえていない`, 400, 'unknown_skill');
    const def = SKILLS[skill.kind];
    // 回復だけのとくぎ (聖光の癒し・癒しの鈴など)。サボるのような MP 回復つきは戦闘だけ。
    if (!def || !isPureHealSkill(skill.kind)) throw new ResolverError('フィールドで つかえるのは 回復の とくぎだけ', 400, 'not_heal_skill');
    if (from.c.hp <= 0) throw new ResolverError(`${from.c.name}は たおれている`, 400, 'caster_down');
    const cost = skillMpCostOf(from.c);
    if (from.c.mp < cost) throw new ResolverError('MPが たりない', 400, 'not_enough_mp');
    const caster2 = { ...from.c, mp: from.c.mp - cost };
    const after = new Map<string, Combatant>([[from.id, caster2]]);
    const healed: SkillResult['healed'] = [];
    const living = members.filter((m) => m.c.hp > 0);
    for (const effect of def.effects) {
      if (effect.kind !== 'heal') continue;
      const to = effectTarget(effect);
      const targets = to === 'allAllies' ? living : to === 'oneAlly' ? [pick(members, target, 'かいふくする相手')] : [from];
      for (const t of targets) {
        if (t.c.hp <= 0) throw new ResolverError(`${t.c.name}は たおれている`, 400, 'target_down');
        const c = { ...(after.get(t.id) ?? t.c) };
        const hp = Math.min(c.maxHp, c.hp + healAmount(c.maxHp, effect.ratio));
        healed.push({ id: t.id, name: c.name, amount: hp - c.hp });
        c.hp = hp;
        after.set(t.id, c);
      }
    }
    if (healed.every((h) => h.amount <= 0)) throw new ResolverError('HP は満タン', 400, 'full');
    result = { healed, casterName: from.c.name, skillName: skill.name };
    let next = cur;
    for (const [id, c] of after) next = withVitals(next, id, c);
    return { ...next, shopOps: [...(cur.shopOps ?? []), op].slice(-MAX_SHOP_OPS) };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { ...result, carryHp: written.carryHp, carryMp: written.carryMp, ...(written.party ? { party: written.party } : {}) };
}
