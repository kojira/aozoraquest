/**
 * パーティの編成と、ギルドに来る冒険者の候補 (D-PARTY-001 / D-PARTY-002)。ギルドの受付のそばでだけ使える。
 * 権威は edge: 位置は署名済みトークン (無ければ state の位置)、使えるかは state.flags で確かめる。
 *
 * - 候補 (`POST /api/party/candidates`): 1 ギルド 1 日 (JST) 3 人。seed は recruitSeed (サーバー秘密 + did + ギルド +
 *   日付 + その日に引き直した回数) なので、読みなおしても同じで、client は先読みできない。候補は state に保存しない
 * - 引き直し (`POST /api/party/reroll`): パワー RECRUIT_GACHA.rerollPower。回数の上限はない。同じ rkey は 1 回だけ
 *   (shopOps の冪等キー)。パワーが足りなければ 400 not_enough_power
 * - 編成 (`POST /api/party`): 仲間に入れるのは無料。
 *   - 入れられる人数 (主人公を含む) は partyCapacity(flags)。超えると 400 party_full、まだ組めなければ 400 party_locked
 *   - 新しく入れられるのは、今日このギルドの候補にいる人だけ (400 unknown_recruit。日付をまたいだときも)
 *   - その日に入れた人・はずしたなじみをまた入れようとすると 400 recruit_gone (はずしたら二度と会えない)
 *   - minLevel が主人公のジョブ Lv より上の人は、payOverLevel: true と rkey があれば パワー overLevelPower (足りない
 *     1 Lv につき 5。§14) を払って入れられる。readModifyWrite の中で確かめて引き、同じ rkey は 1 回だけ (shopOps)。
 *     払うと言わずに入れようとすると 400 recruit_level、パワーが足りなければ 400 not_enough_power (もう入れている人は外さない)
 *   - 名前・職・★・ひとことは edge が作りなおした候補のものを保存する (client の送ったものは使わない)
 *   - 入れた仲間は候補の Lv から始まる (その Lv になったばかりの経験値。§11)
 *   - はずした仲間の経験値・HP/MP・きずな・さくせん は消える。なじみは parted に残る
 *   - 今のデータに無い id は state からも送られた ids からも落とす (確かめる前・数える前)
 */
import {
  allNpcs, dailyRecruits, interiorById, isGeneratedRecruitId, jobLevelFromXp, partyCapacity, partyRecruitOf, recruitById,
  overLevelPower, recruitsAt, regionOf, tierForRegion, xpForAllyLevel, MAX_RECRUITS, RECRUIT_GACHA, WORLD_MAP_ID,
  type Archetype, type NpcDef, type RecruitCandidate,
} from '@aozoraquest/core';
import { readModifyWrite, type GameState, type PartyState } from './game-state';
import { DEFAULT_NS, jobXpOf, migrateInitState, readDiagnosis, ResolverError, type ResolverEnv } from './battle-resolver';
import { besideNpc } from './game-quest';
import { positionAndState } from './story-battle';
import { recruitSeed } from './world-token';
import { dayKey } from './xp-claim';
import { MAX_SHOP_OPS } from './shop';

export interface PartySetResult { party: PartyState; power: number }
/** Lv の足りない候補を、パワーを払って迎える (§14)。op は shopOps に残す冪等キー。 */
export interface OverLevelPayment { op: string }
export interface PartyCandidatesResult {
  day: string;
  /** 今日の候補のうち、まだ入れていない人 (枠の順)。 */
  candidates: RecruitCandidate[];
  power: number;
  rerollPower: number;
}

/** ギルドの街の tier (受付のいる内部マップが指す街、無ければ受付の座標)。 */
function guildTier(npc: NpcDef): number {
  const map = npc.mapId && npc.mapId !== WORLD_MAP_ID ? interiorById(npc.mapId) : undefined;
  const at = map ? (map.shop?.town ?? (map.exitTo?.mapId === WORLD_MAP_ID ? map.exitTo : undefined)) : { x: npc.x, y: npc.y };
  return at ? tierForRegion(regionOf(at.x, at.y)) : 1;
}

function guildNpc(guild: string): NpcDef {
  const npc = allNpcs().find((n) => n.id === guild && n.guildReception === true);
  if (!npc) throw new ResolverError('その ギルドは ない', 404, 'unknown_guild');
  return npc;
}

/** 今日の met / rerolls (日付が変わっていたら空)。 */
const metToday = (p: PartyState | undefined, day: string) => (p?.met?.day === day ? p.met.ids : []);
const rollsToday = (p: PartyState | undefined, day: string) => (p?.rerolls?.day === day ? p.rerolls.byGuild : {});

/** 今日このギルドの候補 3 人 (入れた人も含む。枠の順)。純関数。 */
export function guildCandidates(env: ResolverEnv, did: string, cur: GameState, guild: string, tier: number, day: string, jobLevel: number): RecruitCandidate[] {
  const flags = cur.flags ?? [];
  const parted = cur.party?.parted ?? [];
  const named = recruitsAt(guild, flags);
  if (!RECRUIT_GACHA.enabled) {
    // 戻すとき (§6): 名前つきの冒険者をそのまま紹介する。Lv は主人公のジョブ Lv。
    return named.filter((r) => !parted.includes(r.id)).map((r) => ({ id: r.id, name: r.name, archetype: r.archetype, star: 2, level: jobLevel, minLevel: r.minLevel ?? 1, line: r.line, named: true }));
  }
  const roll = rollsToday(cur.party, day)[guild] ?? 0;
  return dailyRecruits({ seed: recruitSeed(env, did, guild, day, roll), day, guild, roll, tier, named, skip: [...parted, ...(cur.party?.ids ?? [])] });
}

/** 新しい ids を検証して state に当てる (純関数。CAS のリトライで何度呼ばれても同じ)。offered は今日の候補。
 *  pay があれば、Lv の足りない人のパワーを引いて pay.op を shopOps に残す。 */
export function partyWith(cur: GameState, submitted: readonly string[], archetype: Archetype, offered: readonly RecruitCandidate[], day: string, pay?: OverLevelPayment): GameState {
  const flags = cur.flags ?? [];
  const prev = cur.party;
  const known = (id: string) => !!recruitById(id) || !!prev?.members?.some((m) => m.id === id) || offered.some((c) => c.id === id);
  // 今のデータに無い id (admin で消した・名前を変えた冒険者、日付の過ぎた候補) は、数える前に落とす。
  const had = (prev?.ids ?? []).filter(known);
  const ids = submitted.filter((id) => had.includes(id) || known(id) || isGeneratedRecruitId(id));
  const cap = partyCapacity(flags) - 1;
  if (cap <= 0) throw new ResolverError('まだ パーティを 組めない', 400, 'party_locked');
  if (new Set(ids).size !== ids.length) throw new ResolverError('同じ人は ふたり入れられない', 400, 'bad_request');
  if (ids.length > cap) throw new ResolverError('パーティは もう いっぱい', 400, 'party_full');
  const met = metToday(prev, day);
  const parted = prev?.parted ?? [];
  const jobLevel = jobLevelFromXp(jobXpOf(cur, archetype), archetype);
  const added: RecruitCandidate[] = [];
  let price = 0;
  for (const id of ids) {
    if (had.includes(id)) continue;
    if (met.includes(id) || parted.includes(id)) throw new ResolverError('その 冒険者とは もう 会えない', 400, 'recruit_gone');
    const c = offered.find((o) => o.id === id);
    if (!c) throw new ResolverError('その 冒険者は ここに いない', 400, 'unknown_recruit');
    if (jobLevel < c.minLevel && !pay) throw new ResolverError(`${c.name}は まだ 仲間に できない (Lv ${c.minLevel} から)`, 400, 'recruit_level');
    price += overLevelPower(c.minLevel, jobLevel);
    added.push(c);
  }
  if (price > cur.power) throw new ResolverError('あおぞらパワーが たりない', 400, 'not_enough_power');
  const paid = price > 0 && pay ? { power: cur.power - price, shopOps: [...(cur.shopOps ?? []), pay.op].slice(-MAX_SHOP_OPS) } : {};
  const keep = <T>(rec: Record<string, T> | undefined) => {
    const out = Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => ids.includes(id)));
    return Object.keys(out).length ? out : undefined;
  };
  const hp = keep(prev?.hp), mp = keep(prev?.mp), bond = keep(prev?.bond), bondHeal = keep(prev?.bondHeal), mode = keep(prev?.mode);
  const members = [
    ...(prev?.members ?? []).filter((m) => ids.includes(m.id)),
    ...added.filter((c) => !c.named).map(partyRecruitOf),
  ];
  const xp = keep({ ...prev?.xp, ...Object.fromEntries(added.filter((c) => c.named).map((c) => [c.id, xpForAllyLevel(c.archetype, c.level)])) });
  const gone = had.filter((id) => !ids.includes(id) && !isGeneratedRecruitId(id));
  const nextParted = [...parted, ...gone.filter((id) => !parted.includes(id))].slice(-MAX_RECRUITS);
  const nextMet = [...met, ...added.map((c) => c.id)].slice(-RECRUIT_GACHA.metMax);
  if (!ids.length && !nextMet.length && !nextParted.length && prev?.rerolls?.day !== day) return { ...cur, ...paid, party: undefined };
  const party: PartyState = {
    ids: [...ids],
    ...(hp ? { hp } : {}), ...(mp ? { mp } : {}),
    ...(bond ? { bond } : {}), ...(bondHeal ? { bondHeal } : {}), ...(mode ? { mode } : {}),
    ...(members.length ? { members } : {}), ...(xp ? { xp } : {}),
    ...(nextMet.length ? { met: { day, ids: nextMet } } : {}),
    ...(nextParted.length ? { parted: nextParted } : {}),
    ...(prev?.rerolls?.day === day ? { rerolls: prev.rerolls } : {}),
  };
  return { ...cur, ...paid, party };
}

/** 受付のそばか確かめ、state・ジョブ Lv・ギルドの tier を返す。 */
async function atGuild(env: ResolverEnv, did: string, guild: string, token: string | undefined, now: number, ns: string) {
  const npc = guildNpc(guild);
  const { pos, state } = await positionAndState(env, did, token, now, ns);
  if (!besideNpc(npc, pos)) throw new ResolverError('ギルドの 受付の そばに いない', 403, 'not_at_guild');
  const { archetype } = await readDiagnosis(did, ns);
  return { state, archetype, tier: guildTier(npc) };
}

const candidatesResult = (env: ResolverEnv, did: string, st: GameState, guild: string, tier: number, day: string, archetype: Archetype): PartyCandidatesResult => {
  const jobLevel = jobLevelFromXp(jobXpOf(st, archetype), archetype);
  const taken = new Set([...metToday(st.party, day), ...(st.party?.ids ?? [])]);
  return { day, candidates: guildCandidates(env, did, st, guild, tier, day, jobLevel).filter((c) => !taken.has(c.id)), power: st.power, rerollPower: RECRUIT_GACHA.rerollPower };
};

export async function handlePartyCandidates(env: ResolverEnv, did: string, guild: string, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<PartyCandidatesResult> {
  const { state, archetype, tier } = await atGuild(env, did, guild, token, now, ns);
  return candidatesResult(env, did, state, guild, tier, dayKey(now), archetype);
}

/** 候補を引き直す (§10)。パワーは readModifyWrite の中で確かめて引く。同じ rkey の再送は 1 回ぶんだけ。 */
export async function handlePartyReroll(env: ResolverEnv, did: string, guild: string, rkey: unknown, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<PartyCandidatesResult> {
  if (typeof rkey !== 'string' || !rkey || rkey.length > 128) throw new ResolverError('rkey が不正', 400, 'bad_request');
  const { archetype, tier } = await atGuild(env, did, guild, token, now, ns);
  const day = dayKey(now);
  const op = `reroll:${rkey}`;
  const after = await readModifyWrite(env, did, (cur) => {
    if ((cur.shopOps ?? []).includes(op)) return cur;
    if (cur.power < RECRUIT_GACHA.rerollPower) throw new ResolverError('あおぞらパワーが たりない', 400, 'not_enough_power');
    const byGuild = { ...rollsToday(cur.party, day) };
    byGuild[guild] = (byGuild[guild] ?? 0) + 1;
    const party: PartyState = { ...(cur.party ?? { ids: [] }), rerolls: { day, byGuild } };
    return { ...cur, power: cur.power - RECRUIT_GACHA.rerollPower, party, shopOps: [...(cur.shopOps ?? []), op].slice(-MAX_SHOP_OPS) };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return candidatesResult(env, did, after, guild, tier, day, archetype);
}

/** 編成を送る。payOverLevel: true なら Lv の足りない人のパワーを払う (§14。rkey が要る。同じ rkey の再送は 1 回ぶんだけ)。 */
export async function handlePartySet(env: ResolverEnv, did: string, guild: string, ids: unknown, token: string | undefined, now: number, ns: string = DEFAULT_NS, payOverLevel?: unknown, rkey?: unknown): Promise<PartySetResult> {
  if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'string')) throw new ResolverError('ids が不正', 400, 'bad_request');
  if (payOverLevel === true && (typeof rkey !== 'string' || !rkey || rkey.length > 128)) throw new ResolverError('rkey が不正', 400, 'bad_request');
  const { archetype, tier } = await atGuild(env, did, guild, token, now, ns);
  const day = dayKey(now);
  const pay = payOverLevel === true ? { op: `recruit:${rkey as string}` } : undefined;
  const after = await readModifyWrite(env, did, (cur) => {
    if (pay && (cur.shopOps ?? []).includes(pay.op)) return cur;
    const jobLevel = jobLevelFromXp(jobXpOf(cur, archetype), archetype);
    return partyWith(cur, ids, archetype, guildCandidates(env, did, cur, guild, tier, day, jobLevel), day, pay);
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] }, power: after.power };
}
