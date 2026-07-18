/**
 * サーバー権威の戦闘解決 — docs/21-server-authority §5 / M3-part2。
 *
 * **移動も攻撃も毎ターン Worker が処理する**のがアンチチートの核心:
 *   - encounter: 権威 state + (x,y) 由来 tier + ユーザー診断 (archetype/baseStats) から startBattle 入力を
 *     **サーバーが封印** (playerSnapshot はクライアントから受けない = §5 C1)。バトルガードを作成し、
 *     turn1 用の pendingTurnSeed を事前採番。**内部 seed は client に返さない** (先読み防止 #348)。
 *   - turn: バトルガードを読み、確定済み pendingTurnSeed で resolveTurn → 決着なら報酬を権威 state に
 *     **fail-closed で確定** (readModifyWrite。トークン切れ等は throw = 報酬なし、クライアント権威への
 *     フォールバックは存在しない §3-6)。未決着なら turn+1・新 pendingTurnSeed を **CAS で確定してから応答**
 *     (同一ターンの並行二重解決/引き直しを弾く)。
 */
import {
  startBattle, resolveTurn, statVectorToArray, jobLevelFromXp, playerLevelFromXp,
  terrainAt, isWalkable, regionOf, regionDanger, tierForDanger, BATTLE_TUNING,
  type BattleState, type Command, type Archetype, type StatVector,
} from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readGuard, createGuard, advanceGuard, deleteGuard, type BattleGuard } from './battle-guard';
import { readState, readModifyWrite, emptyState, type GameStateEnv, type GameState } from './game-state';
import { applyBattleOutcome, type AwardBreakdown, type BattleDecision } from './battle-reward';
import { resolveDidDocument } from './service-auth';
import { pdsEndpointFromDoc } from './oauth-metadata';
import { getRecord, PdsError } from './pds';

export const ANALYSIS_COLLECTION = 'app.aozoraquest.analysis';
export const VALID_COMMANDS: readonly Command[] = ['attack', 'guard', 'skill', 'herb', 'tonic', 'flee'];

/** 戦闘解決に必要な env (権威 state 読み書き + ユーザー診断 fetch)。 */
export type ResolverEnv = GameStateEnv;

/** ガードに封印する startBattle 由来のメタ (turn では state を使うが、報酬用に archetype を残す)。 */
interface SealedMeta {
  archetype: string;
  tier: 1 | 2 | 3;
}

type Guard = BattleGuard<SealedMeta, BattleState>;

/** 解決エラー。上位が HTTP status に振り分ける。 */
export class ResolverError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** client 向けに BattleState から内部 seed を除去 (先読み防止 #348)。 */
function stripState(s: BattleState) {
  const { seed: _seed, ...rest } = s;
  return rest;
}

/** ユーザーの PDS を DID から解決 (診断の public 読取用)。 */
async function resolveUserPds(userDid: string, fetchImpl?: typeof fetch): Promise<string> {
  const doc = (await resolveDidDocument(userDid, fetchImpl)) as { id: string; service?: { id: string; type: string; serviceEndpoint: string }[] };
  return pdsEndpointFromDoc(doc, userDid);
}

/** ユーザーの診断 (archetype + baseStats) を PDS から読む。無ければ ResolverError(409)。 */
async function readDiagnosis(userDid: string, fetchImpl?: typeof fetch): Promise<{ archetype: Archetype; baseStats: ReturnType<typeof statVectorToArray> }> {
  const pds = await resolveUserPds(userDid, fetchImpl);
  const rec = await getRecord<{ archetype: Archetype; rpgStats: StatVector }>(pds, userDid, ANALYSIS_COLLECTION, 'self');
  if (!rec?.value?.archetype || !rec.value.rpgStats) throw new ResolverError('診断が未実施 (先に気質診断が必要)', 409);
  return { archetype: rec.value.archetype, baseStats: statVectorToArray(rec.value.rpgStats) };
}

export interface EncounterResult {
  battleId: string;
  monsterId: string;
  /** seed を除いた戦闘 state (HP/MP・monster・events 等)。 */
  state: Omit<BattleState, 'seed'>;
  rewarded: boolean;
}

/**
 * encounter: (x,y) で遭遇を成立させ、サーバーが snapshot を封印してバトルを開始する。
 * クライアントは監視 (どのモンスター・初期 HP/MP) しか受け取らない。1 ユーザー 1 戦闘。
 */
export async function handleEncounter(env: ResolverEnv, userDid: string, x: number, y: number, now: number, fetchImpl?: typeof fetch): Promise<EncounterResult> {
  const terrain = terrainAt(x, y);
  if (!isWalkable(terrain) || terrain === 'town') throw new ResolverError('その地形では遭遇しない', 400);

  // 既存ガードがあれば二重戦闘不可 (createGuard の swap=null が弾くが、明示的に 409)。
  if (await readGuard<SealedMeta, BattleState>(env, userDid)) throw new ResolverError('既に戦闘中', 409);

  const existing = await readState(env, userDid);
  const state = existing?.state ?? emptyState(userDid, new Date(now * 1000).toISOString());
  const { archetype, baseStats } = await readDiagnosis(userDid, fetchImpl);

  const tier = tierForDanger(regionDanger(regionOf(x, y)));
  const seed = (await entropyU32()).value; // 召喚/敵ステ用 (client には返さない)
  const jobLevel = jobLevelFromXp(state.jobXp[archetype] ?? 0);
  const playerLevel = playerLevelFromXp(state.playerXp);

  const battle = startBattle(archetype, jobLevel, playerLevel, userDid, tier, seed, state.herbs ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats,
    equipIds: state.gear,
    tonics: state.tonics ?? 0,
    vitalsVariance: BATTLE_TUNING.monsterVitalsVariance ?? 0.15,
  });

  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const pendingTurnSeed = (await entropyU32()).value;
  const battleId = 'b' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const nowIso = new Date(now * 1000).toISOString();
  const guard: Guard = {
    did: userDid, battleId, turn: 0, sealed: { archetype, tier }, state: battle, pendingTurnSeed, rewarded,
    expiresAt: new Date((now + 3600) * 1000).toISOString(), createdAt: nowIso, updatedAt: nowIso,
  };
  await createGuard(env, now, guard); // 既存があれば InvalidSwap → 上位で 409

  return { battleId, monsterId: battle.monsterId, state: stripState(battle), rewarded };
}

export interface TurnResult {
  state: Omit<BattleState, 'seed'>;
  events: BattleState['lastEvents'];
  outcome: BattleState['outcome'];
  awarded?: AwardBreakdown;
}

/**
 * turn: 1 コマンドを**サーバーが**確定 pendingTurnSeed で解決する。
 * 決着なら報酬を fail-closed で確定 + ガード削除。未決着なら CAS で turn を進めてから応答。
 */
export async function handleTurn(env: ResolverEnv, userDid: string, battleId: string, turn: number, command: Command, now: number): Promise<TurnResult> {
  if (!VALID_COMMANDS.includes(command)) throw new ResolverError('不正なコマンド', 400);
  const g = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (!g) throw new ResolverError('戦闘中でない', 409);
  const { guard, cid } = g;
  // battleId / turn 不一致 = リプレイ/やり直し → 409 (応答しない)。
  if (guard.battleId !== battleId || guard.turn !== turn) throw new ResolverError('ターン不一致 (やり直し/リプレイ)', 409);

  const next = resolveTurn(guard.state, command, guard.pendingTurnSeed);

  if (next.outcome !== 'ongoing') {
    // ── 決着: 報酬を権威 state に fail-closed で確定 ──
    const decision = next.outcome as BattleDecision;
    const rewardSeed = (await entropyU32()).value;
    const lossSeed = (await entropyU32()).value;
    let awarded: AwardBreakdown = {};
    // readModifyWrite がトークン切れ等で throw したら報酬は付かず、ガードも消さない (リトライ可)。
    // = クライアント権威へのフォールバックは存在しない。mutate は決定的なので awarded の取り込みは安全。
    await readModifyWrite(env, userDid, (cur: GameState): GameState => {
      const r = applyBattleOutcome(cur, {
        outcome: decision, monsterId: next.monsterId, archetype: guard.sealed.archetype,
        luk: next.player.luk, rewardSeed, lossSeed, rewarded: guard.rewarded,
      });
      awarded = r.awarded;
      // 戦闘をまたぐ HP/MP・消費アイテムも権威 state に反映 (負けは全快で復帰)。
      return {
        ...r.next,
        carryHp: decision === 'lose' ? undefined : next.player.hp,
        carryMp: decision === 'lose' ? undefined : next.player.mp,
        herbs: next.herbs,
        tonics: next.tonics,
      };
    }, { now });
    // 報酬確定後にガード削除 (ここで失敗しても報酬は確定済 = 二重報酬なし。次 encounter が flush)。
    try { await deleteGuard(env, now, userDid, cid); } catch { /* CAS 不一致は無視 (別リクエストが消した) */ }
    return { state: stripState(next), events: next.lastEvents, outcome: next.outcome, awarded };
  }

  // ── 未決着: turn+1・新 pendingTurnSeed を CAS で確定してから応答 (並行二重解決/引き直しを弾く) ──
  const nextPending = (await entropyU32()).value;
  const advanced: Guard = { ...guard, turn: turn + 1, state: next, pendingTurnSeed: nextPending, updatedAt: new Date(now * 1000).toISOString() };
  try {
    await advanceGuard(env, now, advanced, cid);
  } catch (e) {
    if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') throw new ResolverError('ターン競合 (やり直し/リプレイ)', 409);
    throw e;
  }
  return { state: stripState(next), events: next.lastEvents, outcome: next.outcome };
}
