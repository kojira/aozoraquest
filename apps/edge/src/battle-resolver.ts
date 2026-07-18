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
  terrainAt, isWalkable, regionOf, regionDanger, tierForDanger, encounterRateFor, BATTLE_TUNING,
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

export const POWER_COLLECTION = 'app.aozoraquest.power';

/** §6-4 移行の上限クランプ (偽造済みかもしれない PDS 現値を切り詰める)。**dev=owner は無害・一般ユーザー
 *  移行は M5 で再検討 (§9-4 未解決)**。値の根拠はコミットメッセージ参照。 */
export const MAX_MIGRATE_POWER = 1000;
export const MAX_MIGRATE_PLAYER_XP = 500_000; // lvl 99 ≈ 457k を上回る安全上限
export const MAX_MIGRATE_JOB_XP = 50_000; // lvl 50 ≈ 40k を上回る安全上限

const finiteNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** ユーザー PDS の power/self 累積カウンタ (points.ts と同じ形)。残高は client の deriveState と同式。 */
interface MigratablePowerRecord {
  viaPosts?: number; userMessages?: number; cardDraws?: number; battles?: number;
  craftPowerSpent?: number; salePowerEarned?: number; searchPowerSpent?: number;
}
interface MigratableAnalysisRecord {
  playerLevel?: { xp?: number };
  jobLevel?: { archetype?: string; xp?: number };
}

/**
 * 初回 gameState 生成時の移行 (§6-4)。ユーザー PDS の **既存 power 残高と分析 Lv を上限クランプして取り込む**
 * (取り込まないと power=0 → 常に rewarded=false = 報酬が出ず、Lv=1 で弱すぎる)。**読取専用** (PDS へは書かない)
 * ので、読めない/未診断でも fail-open で emptyState に倒す (書込 fail-closed とは別物)。**state が null の
 * ときだけ**呼ばれる (readModifyWrite) = 通常経路にコストを乗せない。
 */
export async function migrateInitState(userDid: string, nowIso: string, fetchImpl?: typeof fetch): Promise<GameState> {
  const base = emptyState(userDid, nowIso);
  try {
    const pds = await resolveUserPds(userDid, fetchImpl);
    const [powerRec, analysisRec] = await Promise.all([
      getRecord<MigratablePowerRecord>(pds, userDid, POWER_COLLECTION, 'self').catch(() => null),
      getRecord<MigratableAnalysisRecord>(pds, userDid, ANALYSIS_COLLECTION, 'self').catch(() => null),
    ]);
    const p = powerRec?.value;
    if (p) {
      const bal = Math.max(0, finiteNum(p.viaPosts) - finiteNum(p.userMessages) - finiteNum(p.cardDraws)
        - finiteNum(p.battles) - finiteNum(p.craftPowerSpent) - finiteNum(p.searchPowerSpent) + finiteNum(p.salePowerEarned));
      base.power = Math.min(bal, MAX_MIGRATE_POWER);
    }
    const a = analysisRec?.value;
    if (a) {
      base.playerXp = Math.min(finiteNum(a.playerLevel?.xp), MAX_MIGRATE_PLAYER_XP);
      if (a.jobLevel?.archetype) base.jobXp = { [a.jobLevel.archetype]: Math.min(finiteNum(a.jobLevel.xp), MAX_MIGRATE_JOB_XP) };
    }
  } catch { /* 読めない/未診断は power 0・Lv1 で開始 (読取のみ = 無害) */ }
  return base;
}

/** バトルガードの寿命 (秒)。各ターンで更新。切れたガードは move 時に flush = クラッシュしても
 *  永久ロックアウトしない (docs/21 §5 lazy 敗北)。 */
export const GUARD_TTL_SEC = 900;

export interface EncounterInfo {
  battleId: string;
  monsterId: string;
  /** seed を除いた戦闘 state (HP/MP・monster・events 等)。 */
  state: Omit<BattleState, 'seed'>;
  rewarded: boolean;
}

/** 遭遇を成立させ snapshot を封印してガードを作る。位置は**権威** (move が渡す) = tier を選べない。
 *  move からのみ呼ばれる (client から直接遭遇を起こせない = 座標/遭遇を偽造不可)。export はテスト用。 */
export async function sealEncounter(env: ResolverEnv, userDid: string, state: GameState, x: number, y: number, now: number, fetchImpl?: typeof fetch): Promise<EncounterInfo> {
  const { archetype, baseStats } = await readDiagnosis(userDid, fetchImpl);
  const tier = tierForDanger(regionDanger(regionOf(x, y)));
  const seed = (await entropyU32()).value; // 召喚/敵ステ用 (client には返さない)
  const jobLevel = jobLevelFromXp(state.jobXp[archetype] ?? 0);
  const playerLevel = playerLevelFromXp(state.playerXp);
  const battle = startBattle(archetype, jobLevel, playerLevel, userDid, tier, seed, state.herbs ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats, equipIds: state.gear, tonics: state.tonics ?? 0, vitalsVariance: BATTLE_TUNING.monsterVitalsVariance,
  });
  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const pendingTurnSeed = (await entropyU32()).value;
  const battleId = 'b' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const nowIso = new Date(now * 1000).toISOString();
  const guard: Guard = {
    did: userDid, battleId, turn: 0, sealed: { archetype, tier }, state: battle, pendingTurnSeed, rewarded,
    expiresAt: new Date((now + GUARD_TTL_SEC) * 1000).toISOString(), createdAt: nowIso, updatedAt: nowIso,
  };
  await createGuard(env, now, guard); // 既存があれば InvalidSwap → 上位で 409
  return { battleId, monsterId: battle.monsterId, state: stripState(battle), rewarded };
}

export interface MoveResult {
  x: number;
  y: number;
  terrain: string;
  /** 街に入って全回復した (HP/MP が権威なのでサーバーが回復)。 */
  healed?: boolean;
  /** サーバーが遭遇を判定した場合のみ。 */
  encounter?: EncounterInfo;
}

/**
 * move: **位置を Worker が権威更新し、遭遇もサーバーが判定する**。クライアントは方向 (隣接1マス) しか
 * 送れず、座標も遭遇有無も tier も偽造できない (§5 のアンチチート核: 移動を毎回 Worker で処理)。
 */
export async function handleMove(env: ResolverEnv, userDid: string, dx: number, dy: number, now: number, fetchImpl?: typeof fetch): Promise<MoveResult> {
  if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy) || (dx === 0 && dy === 0)) throw new ResolverError('不正な移動 (隣接1マスのみ)', 400);

  // 未決着ガード: 期限内なら移動不可 (戦闘中)、期限切れは flush して先へ (クラッシュ復帰・ロックアウト回避)。
  const g = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (g) {
    if (now * 1000 < Date.parse(g.guard.expiresAt)) throw new ResolverError('戦闘中は移動不可', 409);
    await deleteGuard(env, now, userDid, g.cid); // 期限切れ = lazy flush (踏み倒し容認 §5)
  }

  // 権威位置を CAS 更新。移動先の歩行可否は mutate 内で検証 (CAS リトライで再検証される)。
  // 街に入ったら HP/MP を全回復 (carry を消す = 次戦全快。HP が権威なのでサーバーが行う)。
  const committed = { x: 0, y: 0, healed: false };
  const moved = await readModifyWrite(env, userDid, (cur: GameState): GameState => {
    const tx = cur.x + dx, ty = cur.y + dy;
    const t = terrainAt(tx, ty);
    if (!isWalkable(t)) throw new ResolverError('進めない地形', 400);
    committed.x = tx; committed.y = ty; committed.healed = t === 'town';
    const next: GameState = { ...cur, x: tx, y: ty };
    if (t === 'town') { next.carryHp = undefined; next.carryMp = undefined; }
    return next;
  }, { now, init: (did, nowIso) => migrateInitState(did, nowIso, fetchImpl) });

  const terrain = terrainAt(committed.x, committed.y);
  if (terrain !== 'town') {
    const roll = (await entropyU32()).value / 0x1_0000_0000; // [0,1)
    if (roll < encounterRateFor(terrain)) {
      const encounter = await sealEncounter(env, userDid, moved, committed.x, committed.y, now, fetchImpl);
      return { x: committed.x, y: committed.y, terrain, encounter };
    }
  }
  return { x: committed.x, y: committed.y, terrain, healed: committed.healed || undefined };
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
    // ── 決着: **まずガードを CAS 削除して「この決着ターンは自分が消費」を確定** ──
    // これで並行/リプレイの重複リクエストは InvalidSwap → 409 になり、報酬確定に到達できるのは
    // ガードを消せた 1 リクエストだけ = **二重報酬を防ぐ** (applyBattleOutcome は加算なので必須。§4.1c 冪等)。
    // token 切れで delete が失敗 → ServerWriteError が伝播し上位で 503 (報酬なし・guard 残る=リトライ可、
    // fail-closed)。この順序 (消費確定 → 報酬) が §4.1 の「CAS で先に確定 → その後 resolve/確定」。
    const decision = next.outcome as BattleDecision;
    try {
      await deleteGuard(env, now, userDid, cid);
    } catch (e) {
      if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') throw new ResolverError('決着競合 (二重確定防止)', 409);
      throw e; // ServerWriteError(token 切れ) 等 → 上位で 503 (報酬なし)
    }
    // ここに来られるのはガードを消せた 1 リクエストだけ → 報酬を fail-closed で確定。
    const rewardSeed = (await entropyU32()).value;
    const lossSeed = (await entropyU32()).value;
    let awarded: AwardBreakdown = {};
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
    return { state: stripState(next), events: next.lastEvents, outcome: next.outcome, awarded };
  }

  // ── 未決着: turn+1・新 pendingTurnSeed を CAS で確定してから応答 (並行二重解決/引き直しを弾く) ──
  // expiresAt も更新し、長い戦闘が move の flush 対象にならないようにする (ターンごとに寿命を延ばす)。
  const nextPending = (await entropyU32()).value;
  const nowIso = new Date(now * 1000).toISOString();
  const advanced: Guard = { ...guard, turn: turn + 1, state: next, pendingTurnSeed: nextPending, expiresAt: new Date((now + GUARD_TTL_SEC) * 1000).toISOString(), updatedAt: nowIso };
  try {
    await advanceGuard(env, now, advanced, cid);
  } catch (e) {
    if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') throw new ResolverError('ターン競合 (やり直し/リプレイ)', 409);
    throw e;
  }
  return { state: stripState(next), events: next.lastEvents, outcome: next.outcome };
}
