/**
 * パーティの編成 (`POST /api/party`、D-PARTY-001)。ギルドの受付のそばでだけ、仲間を入れる・外す・入れかえる。
 * 費用はかからない。権威は edge: 位置は署名済みトークン (無ければ state の位置)、使えるかは state.flags で確かめる。
 * - 入れられる人数 (主人公を含む) は partyCapacity(flags)。超えると 400 party_full、まだ組めなければ 400 party_locked
 * - 新しく入れられるのは、そのギルドがいま紹介している冒険者だけ。もう入れている仲間はそのまま残せる
 * - 外した仲間の HP/MP の持ちこしは消す (また入れると全快で戻る)
 */
import { allNpcs, partyCapacity, recruitById, recruitsAt } from '@aozoraquest/core';
import { readModifyWrite, type GameState, type PartyState } from './game-state';
import { DEFAULT_NS, migrateInitState, ResolverError, type ResolverEnv } from './battle-resolver';
import { besideNpc } from './game-quest';
import { positionAndState } from './story-battle';

export interface PartySetResult { party: PartyState }

/** 新しい ids を検証して state に当てる (純関数。CAS のリトライで何度呼ばれても同じ)。 */
export function partyWith(cur: GameState, guild: string, ids: readonly string[]): GameState {
  const flags = cur.flags ?? [];
  const cap = partyCapacity(flags) - 1;
  if (cap <= 0) throw new ResolverError('まだ パーティを 組めない', 400, 'party_locked');
  if (new Set(ids).size !== ids.length) throw new ResolverError('同じ人は ふたり入れられない', 400, 'bad_request');
  if (ids.length > cap) throw new ResolverError('パーティは もう いっぱい', 400, 'party_full');
  const had = cur.party?.ids ?? [];
  const offered = new Set(recruitsAt(guild, flags).map((r) => r.id));
  for (const id of ids) {
    if (!recruitById(id) || (!had.includes(id) && !offered.has(id))) throw new ResolverError('その 冒険者は ここに いない', 400, 'unknown_recruit');
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
  const after = await readModifyWrite(env, did, (cur) => partyWith(cur, guild, ids), { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] } };
}
