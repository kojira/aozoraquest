/**
 * 宿屋に泊まる (#766)。扉に入る move では何もせず、会話で「はい」と答えたときだけ呼ばれる。
 * 位置は署名済みトークン (無ければ state の位置) が正で、宿屋の扉の上にいるときだけ通す。
 * 満タン / パワー不足 / 支払いの判定は、もと move にあったもの (#424) をそのまま移した。
 */
import { innAt, nearestShrineTown, WORLD_MAP_ID } from '@aozoraquest/core';
import { downedIds, readModifyWrite, restedParty } from './game-state';
import { DEFAULT_NS, migrateInitState, ResolverError, type ResolverEnv } from './battle-resolver';
import { positionAndState } from './story-battle';

export interface InnRestResult {
  /** 泊まった (paid>0) か、満タンで泊まる必要がなかった (paid=0)。残高はサーバーが正。 */
  inn?: { name?: string; paid: number; power: number };
  /** パワーが足りず泊まれなかった。 */
  innDenied?: { name?: string; price: number; power: number };
  /** 倒れたままの仲間の数と、いちばん近い ほこら の町 (宿では起きない。D-REVIVE-001)。 */
  downed?: { count: number; shrineTown?: string };
}

/** `POST /api/inn/rest`。 */
export async function handleInnRest(env: ResolverEnv, did: string, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<InnRestResult> {
  const { pos, state: st } = await positionAndState(env, did, token, now, ns);
  const mapId = pos.mapId ?? WORLD_MAP_ID;
  const innHere = innAt(mapId, pos.x, pos.y);
  if (!innHere) throw new ResolverError('やどやの なかに いない', 400, 'not_at_inn');
  const name = innHere.name ? { name: innHere.name } : {};
  const downCount = downedIds(st.party).length;
  const shrineTown = downCount ? nearestShrineTown(mapId, pos.x, pos.y) : undefined;
  const downed = downCount ? { downed: { count: downCount, ...(shrineTown ? { shrineTown } : {}) } } : {};
  // **満タンなら課金しない** — 全快で泊まる理由がない。倒れた仲間は宿では起きないので数えない (D-REVIVE-001)。
  const hurt = st.carryHp !== undefined || st.carryMp !== undefined || Object.values(st.party?.hp ?? {}).some((v) => v > 0) || st.party?.mp !== undefined;
  if (!hurt) return { inn: { ...name, paid: 0, power: st.power }, ...downed };
  if (st.power < innHere.price) return { innDenied: { ...name, price: innHere.price, power: st.power }, ...downed };
  const after = await readModifyWrite(env, did, (cur) => {
    // 残高は毎回読み直す (CAS リトライで二重に引かない)。
    if (cur.power < innHere.price) throw new ResolverError('パワーが たりない', 400, 'inn_poor');
    return { ...cur, power: cur.power - innHere.price, carryHp: undefined, carryMp: undefined, party: restedParty(cur.party), x: pos.x, y: pos.y, mapId };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { inn: { ...name, paid: innHere.price, power: after.power }, ...downed };
}
