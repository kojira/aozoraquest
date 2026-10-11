/**
 * 宿屋に泊まる (#766)。扉に入る move では何もせず、会話で「はい」と答えたときだけ呼ばれる。
 * 位置は署名済みトークン (無ければ state の位置) が正で、宿屋の扉の上にいるときだけ通す。
 * 満タン / パワー不足 / 支払いの判定は、もと move にあったもの (#424) をそのまま移した。
 */
import { innAt, WORLD_MAP_ID } from '@aozoraquest/core';
import { readModifyWrite } from './game-state';
import { DEFAULT_NS, migrateInitState, ResolverError, type ResolverEnv } from './battle-resolver';
import { positionAndState } from './story-battle';

export interface InnRestResult {
  /** 泊まった (paid>0) か、満タンで泊まる必要がなかった (paid=0)。残高はサーバーが正。 */
  inn?: { name?: string; paid: number; power: number };
  /** パワーが足りず泊まれなかった。 */
  innDenied?: { name?: string; price: number; power: number };
}

/** `POST /api/inn/rest`。 */
export async function handleInnRest(env: ResolverEnv, did: string, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<InnRestResult> {
  const { pos, state: st } = await positionAndState(env, did, token, now, ns);
  const mapId = pos.mapId ?? WORLD_MAP_ID;
  const innHere = innAt(mapId, pos.x, pos.y);
  if (!innHere) throw new ResolverError('やどやの なかに いない', 400, 'not_at_inn');
  const name = innHere.name ? { name: innHere.name } : {};
  // **満タンなら課金しない** — 全快で泊まる理由がない。無言だと壊れて見えるので結果は返す。
  const hurt = st.carryHp !== undefined || st.carryMp !== undefined;
  if (!hurt) return { inn: { ...name, paid: 0, power: st.power } };
  if (st.power < innHere.price) return { innDenied: { ...name, price: innHere.price, power: st.power } };
  const after = await readModifyWrite(env, did, (cur) => {
    // 残高は毎回読み直す (CAS リトライで二重に引かない)。
    if (cur.power < innHere.price) throw new ResolverError('パワーが たりない', 400, 'inn_poor');
    return { ...cur, power: cur.power - innHere.price, carryHp: undefined, carryMp: undefined, x: pos.x, y: pos.y, mapId };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { inn: { ...name, paid: innHere.price, power: after.power } };
}
