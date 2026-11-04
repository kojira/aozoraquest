/**
 * パーティの編成 (`POST /api/party`、D-PARTY-001)。ギルドの受付のそばでだけ、仲間を入れる・外す・入れかえる。
 * 費用はかからない。権威は edge: 位置は署名済みトークン (無ければ state の位置)、使えるかは state.flags で確かめる。
 * - 入れられる人数 (主人公を含む) は partyCapacity(flags)。超えると 400 party_full、まだ組めなければ 400 party_locked
 * - 新しく入れられるのは、そのギルドがいま紹介している冒険者だけ。もう入れている仲間はそのまま残せる
 * - 新しく入れる人の minLevel が主人公のジョブ Lv より上なら 400 recruit_level (入れている人は外さない)
 * - 外した仲間の HP/MP の持ちこしは消す (また入れると全快で戻る)
 * - 今のデータに無い id は state からも送られた ids からも落とす (確かめる前・数える前)
 */
import { allNpcs, jobLevelFromXp, partyCapacity, recruitById, recruitLevelOk, recruitsAt, type Archetype } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type PartyState } from './game-state';
import { DEFAULT_NS, jobXpOf, migrateInitState, readDiagnosis, ResolverError, type ResolverEnv } from './battle-resolver';
import { besideNpc } from './game-quest';
import { positionAndState } from './story-battle';

export interface PartySetResult { party: PartyState }

/** 新しい ids を検証して state に当てる (純関数。CAS のリトライで何度呼ばれても同じ)。 */
export function partyWith(cur: GameState, guild: string, submitted: readonly string[], archetype: Archetype): GameState {
  const flags = cur.flags ?? [];
  // 今のデータに無い id (admin で消した・名前を変えた冒険者) は、確かめる前と数える前に落とす。残すと編成が 400 で止まり、人数も 1 つ使う。
  const ids = submitted.filter((id) => recruitById(id));
  const cap = partyCapacity(flags) - 1;
  if (cap <= 0) throw new ResolverError('まだ パーティを 組めない', 400, 'party_locked');
  if (new Set(ids).size !== ids.length) throw new ResolverError('同じ人は ふたり入れられない', 400, 'bad_request');
  if (ids.length > cap) throw new ResolverError('パーティは もう いっぱい', 400, 'party_full');
  const had = (cur.party?.ids ?? []).filter((id) => recruitById(id));
  const offered = new Set(recruitsAt(guild, flags).map((r) => r.id));
  const jobLevel = jobLevelFromXp(jobXpOf(cur, archetype), archetype);
  for (const id of ids) {
    const r = recruitById(id)!;
    if (!had.includes(id) && !offered.has(id)) throw new ResolverError('その 冒険者は ここに いない', 400, 'unknown_recruit');
    if (!had.includes(id) && !recruitLevelOk(r, jobLevel)) throw new ResolverError(`${r.name}は まだ 仲間に できない (Lv ${r.minLevel} から)`, 400, 'recruit_level');
  }
  const keep = <T>(rec: Record<string, T> | undefined) => {
    const out = Object.fromEntries(Object.entries(rec ?? {}).filter(([id]) => ids.includes(id)));
    return Object.keys(out).length ? out : undefined;
  };
  const hp = keep(cur.party?.hp), mp = keep(cur.party?.mp);
  const party: PartyState | undefined = ids.length ? { ids: [...ids], ...(hp ? { hp } : {}), ...(mp ? { mp } : {}) } : undefined;
  return { ...cur, party };
}

export async function handlePartySet(env: ResolverEnv, did: string, guild: string, ids: unknown, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<PartySetResult> {
  if (!Array.isArray(ids) || !ids.every((v) => typeof v === 'string')) throw new ResolverError('ids が不正', 400, 'bad_request');
  const npc = allNpcs().find((n) => n.id === guild && n.guildReception === true);
  if (!npc) throw new ResolverError('その ギルドは ない', 404, 'unknown_guild');
  const { pos } = await positionAndState(env, did, token, now, ns);
  if (!besideNpc(npc, pos)) throw new ResolverError('ギルドの 受付の そばに いない', 403, 'not_at_guild');
  const { archetype } = await readDiagnosis(did, ns);
  const after = await readModifyWrite(env, did, (cur) => partyWith(cur, guild, ids, archetype), { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] } };
}
