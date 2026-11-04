/**
 * ギルドの外で使うパーティの道 (D-PARTY-004)。router.ts からは 1 行で呼ぶ。
 * - `POST /api/party/mode {id, mode}`: 仲間の さくせん (♥2: gangan / inochi / jumon) ／めいれい (♥3: manual)。
 *   mode が null なら おまかせ に戻す (いつでも)。段階が足りない → 400 bond_too_low。パーティにいない → 400 bad_request。
 *   どこでも変えられる。いま戦闘中なら、次の戦闘から効く (封印の時点の値)。
 */
import { ALLY_MODES, bondHearts, LXM, type AllyMode } from '@aozoraquest/core';
import { readModifyWrite, type PartyState } from './game-state';
import { ResolverError, migrateInitState, type ResolverEnv } from './battle-resolver';
import { verifyServiceAuth, ServiceAuthError } from './service-auth';

/** その mode に要る ♥ の数 (さくせん は ♥2、めいれい は ♥3)。 */
export const modeHearts = (mode: AllyMode): number => (mode === 'manual' ? 3 : 2);

export interface PartyModeResult { party: PartyState }

/** 仲間の mode を変える (純関数部分は readModifyWrite の中)。 */
export async function handlePartyMode(env: ResolverEnv, did: string, id: unknown, mode: unknown, now: number, ns: string): Promise<PartyModeResult> {
  if (typeof id !== 'string' || (mode !== null && !ALLY_MODES.includes(mode as AllyMode))) throw new ResolverError('入力が不正', 400, 'bad_request');
  const after = await readModifyWrite(env, did, (cur) => {
    const party = cur.party;
    if (!party?.ids.includes(id)) throw new ResolverError('その仲間は パーティに いない', 400, 'bad_request');
    if (mode !== null && bondHearts(party.bond?.[id]) < modeHearts(mode as AllyMode)) throw new ResolverError('まだ きずなが たりない', 400, 'bond_too_low');
    if ((party.mode?.[id] ?? null) === mode) return cur;
    const next = { ...party.mode };
    if (mode === null) delete next[id]; else next[id] = mode as AllyMode;
    const { mode: _m, ...rest } = party;
    return { ...cur, party: { ...rest, ...(Object.keys(next).length ? { mode: next } : {}) } };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns) });
  return { party: after.party ?? { ids: [] } };
}

const PATHS: Record<string, string> = { '/api/party/mode': LXM.partyMode };

/** ギルドの外の /api/party/* を受ける。この道でなければ null (router は次へ進む)。 */
export async function handlePartyOrdersRoute(req: Request, url: URL, env: ResolverEnv & { WORKER_DID?: string }, now: number, ns: string, respond: (body: unknown, status?: number) => Response, onError: (e: unknown) => Response): Promise<Response | null> {
  const lxm = req.method === 'POST' ? PATHS[url.pathname] : undefined;
  if (!lxm) return null;
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return respond({ error: 'missing_token' }, 401);
  let did: string;
  try {
    ({ iss: did } = await verifyServiceAuth(token, { audience: env.WORKER_DID ?? 'did:web:edge.aozoraquest.app', lxm }));
  } catch (e) {
    return respond({ error: 'unauthorized', reason: e instanceof ServiceAuthError ? e.message : 'verify_failed' }, 401);
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; mode?: unknown };
  try {
    return respond(await handlePartyMode(env, did, body.id, body.mode ?? null, now, ns));
  } catch (e) {
    return onError(e);
  }
}
