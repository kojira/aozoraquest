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
  terrainAt, isWalkable, wrap, regionOf, regionDanger, tierForDanger, encounterRateFor, worldOverlay, BATTLE_TUNING,
  type BattleState, type Command, type Archetype, type StatVector,
} from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readGuard, createGuard, advanceGuard, deleteGuard, type BattleGuard } from './battle-guard';
import { readState, readModifyWrite, emptyState, type GameStateEnv, type GameState } from './game-state';
import { signPosition, verifyPosition, enemyWindow, tileEncounter } from './world-token';
import { applyBattleOutcome, type AwardBreakdown, type BattleDecision } from './battle-reward';
import { resolveDidDocument } from './service-auth';
import { pdsEndpointFromDoc } from './oauth-metadata';
import { getRecord, PdsError } from './pds';

export const ANALYSIS_COLLECTION = 'app.aozoraquest.analysis';
export const VALID_COMMANDS: readonly Command[] = ['attack', 'guard', 'skill', 'herb', 'tonic', 'flee'];

/** 戦闘解決に必要な env (権威 state 読み書き + ユーザー診断 fetch)。 */
export type ResolverEnv = GameStateEnv;

/** ガードに封印する startBattle 由来のメタ (turn では state を使うが、報酬/撃破記録用に残す)。 */
interface SealedMeta {
  archetype: string;
  tier: 1 | 2 | 3;
  /** 遭遇したタイル "x,y" (撃破時に defeated へ入れ、その枠で再エンカウントさせない)。 */
  tile: string;
}

type Guard = BattleGuard<SealedMeta, BattleState>;

/** 解決エラー。上位が HTTP status に振り分ける。code はクライアントが文言を出し分ける用 (任意)。 */
export class ResolverError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
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
  if (!rec?.value?.archetype || !rec.value.rpgStats) throw new ResolverError('診断が未実施 (先に気質診断が必要)', 409, 'diagnosis_required');
  return { archetype: rec.value.archetype, baseStats: statVectorToArray(rec.value.rpgStats) };
}

export const POWER_COLLECTION = 'app.aozoraquest.power';

/** §6-4 移行の上限クランプ (偽造済みかもしれない PDS 現値を切り詰める)。**dev=owner は無害・一般ユーザー
 *  移行は M5 で再検討 (§9-4 未解決)**。真の偽造対策は M4 の投稿 XP 権威化で、これは絶対値の暴走を切る
 *  緩いサニティ上限。長期ユーザーの正当残高 (viaPosts 累積) を切り詰めない大きさにする。値の根拠はコミット参照。 */
export const MAX_MIGRATE_POWER = 100_000; // 正当ユーザー (投稿数=残高上限) を十分上回る緩い上限
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
interface MigratableWorldRecord { x?: number; y?: number }
export const WORLD_COLLECTION = 'app.aozoraquest.world';

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
    const [powerRec, analysisRec, worldRec] = await Promise.all([
      getRecord<MigratablePowerRecord>(pds, userDid, POWER_COLLECTION, 'self').catch(() => null),
      getRecord<MigratableAnalysisRecord>(pds, userDid, ANALYSIS_COLLECTION, 'self').catch(() => null),
      getRecord<MigratableWorldRecord>(pds, userDid, WORLD_COLLECTION, 'self').catch(() => null),
    ]);
    // 位置: 旧クライアント world-record から引き継ぐ (ワープ防止)。無ければ spawn。歩ける所に限る。
    const w = worldRec?.value;
    const spawn = worldOverlay().spawn;
    const px = typeof w?.x === 'number' && Number.isFinite(w.x) ? wrap(w.x) : spawn.x;
    const py = typeof w?.y === 'number' && Number.isFinite(w.y) ? wrap(w.y) : spawn.y;
    base.x = isWalkable(terrainAt(px, py)) ? px : spawn.x;
    base.y = isWalkable(terrainAt(px, py)) ? py : spawn.y;
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
 *  `monsterSeed` は tile+30分枠+秘密から決定的 (置かれた敵)。client には返さない。export はテスト用。 */
export async function sealEncounter(env: ResolverEnv, userDid: string, state: GameState, x: number, y: number, monsterSeed: number, now: number, fetchImpl?: typeof fetch): Promise<EncounterInfo> {
  const { archetype, baseStats } = await readDiagnosis(userDid, fetchImpl);
  const tier = tierForDanger(regionDanger(regionOf(x, y)));
  const jobLevel = jobLevelFromXp(state.jobXp[archetype] ?? 0);
  const playerLevel = playerLevelFromXp(state.playerXp);
  const battle = startBattle(archetype, jobLevel, playerLevel, userDid, tier, monsterSeed, state.herbs ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats, equipIds: state.gear, tonics: state.tonics ?? 0, vitalsVariance: BATTLE_TUNING.monsterVitalsVariance,
  });
  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const pendingTurnSeed = (await entropyU32({ useKuda: true })).value;
  const battleId = 'b' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const nowIso = new Date(now * 1000).toISOString();
  // move では毎歩ガードを読まない (ステートレス高速化)。ここで、期限切れの古いガードが残っていたら
  // flush してから作る (クラッシュ復帰)。期限内の生きたガードが残っていれば createGuard が InvalidSwap → 409。
  const existing = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (existing && now * 1000 >= Date.parse(existing.guard.expiresAt)) await deleteGuard(env, now, userDid, existing.cid);
  const guard: Guard = {
    did: userDid, battleId, turn: 0, sealed: { archetype, tier, tile: `${x},${y}` }, state: battle, pendingTurnSeed, rewarded,
    expiresAt: new Date((now + GUARD_TTL_SEC) * 1000).toISOString(), createdAt: nowIso, updatedAt: nowIso,
  };
  await createGuard(env, now, guard); // 生きたガードがあれば InvalidSwap → 上位で 409
  return { battleId, monsterId: battle.monsterId, state: stripState(battle), rewarded };
}

export interface MoveResult {
  x: number;
  y: number;
  terrain: string;
  /** 街に入って全回復した (HP/MP が権威なのでサーバーが回復)。 */
  healed?: boolean;
  /** 次の move に渡す新しい位置トークン (署名済み = 改竄不可)。 */
  token: string;
  /** サーバーが遭遇を判定した場合のみ。 */
  encounter?: EncounterInfo;
}

/**
 * move: **位置トークン (署名済み) を検証 → 隣接検証 → 決定的エンカウント判定 → 新トークン発行**。
 * 歩行では PDS を触らない (街/エンカウントの時だけ書く) = 高速。座標・遭遇・tier は署名/秘密で偽造不可。
 * token 未指定/失効時は gameState から位置を再同期する (稀な PDS 読み)。
 */
export async function handleMove(env: ResolverEnv, userDid: string, dx: number, dy: number, token: string | undefined, now: number, fetchImpl?: typeof fetch): Promise<MoveResult> {
  if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy) || (dx === 0 && dy === 0)) throw new ResolverError('不正な移動 (隣接1マスのみ)', 400);

  // 現在位置: 署名トークンが権威。無効/失効なら gameState から再同期 (位置偽造は署名で不可)。
  let cx: number, cy: number, counter = 0;
  try {
    const claim = verifyPosition(env, token ?? '', userDid, now);
    cx = claim.x; cy = claim.y; counter = claim.counter;
  } catch {
    const rec = await readState(env, userDid);
    const s = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), fetchImpl));
    cx = s.x; cy = s.y;
  }

  const nx = wrap(cx + dx), ny = wrap(cy + dy);
  const terrain = terrainAt(nx, ny);
  if (!isWalkable(terrain)) throw new ResolverError('進めない地形', 400);

  let healed = false;
  if (terrain === 'town') {
    // 街: HP/MP 全回復 + 位置を gameState に確定 (稀なので PDS 書き OK。失効時の再同期先にもなる)。
    await readModifyWrite(env, userDid, (cur) => ({ ...cur, x: nx, y: ny, carryHp: undefined, carryMp: undefined }),
      { now, init: (d, iso) => migrateInitState(d, iso, fetchImpl) });
    healed = true;
  }

  const nextToken = signPosition(env, { did: userDid, x: nx, y: ny, counter: counter + 1, iat: now });

  // エンカウント: tile+30分枠+秘密から決定的 (見えない・予測不可・30分でリポップ)。街では出さない。
  if (terrain !== 'town') {
    const window = enemyWindow(now);
    const { roll, monsterSeed } = tileEncounter(env, nx, ny, window);
    if (roll < encounterRateFor(terrain)) {
      const rec = await readState(env, userDid);
      const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), fetchImpl));
      // その 30 分枠で撃破済みのタイルには敵が居ない (同一敵の無限狩り防止)。
      const defeated = state.defeatedWindow === window ? (state.defeated ?? []) : [];
      if (!defeated.includes(`${nx},${ny}`)) {
        const encounter = await sealEncounter(env, userDid, state, nx, ny, monsterSeed, now, fetchImpl);
        return { x: nx, y: ny, terrain, token: nextToken, encounter };
      }
    }
  }
  return { x: nx, y: ny, terrain, healed: healed || undefined, token: nextToken };
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
    const rewardSeed = (await entropyU32({ useKuda: true })).value;
    const lossSeed = (await entropyU32({ useKuda: true })).value;
    let awarded: AwardBreakdown = {};
    const window = enemyWindow(now);
    await readModifyWrite(env, userDid, (cur: GameState): GameState => {
      const r = applyBattleOutcome(cur, {
        outcome: decision, monsterId: next.monsterId, archetype: guard.sealed.archetype,
        luk: next.player.luk, rewardSeed, lossSeed, rewarded: guard.rewarded,
      });
      awarded = r.awarded;
      // 勝ったらそのタイルを「撃破済み」に記録し、同じ 30 分枠では再エンカウントさせない (無限狩り防止)。
      // 枠が変わっていたら defeated をリセット (敵配置が入れ替わる)。
      const prevDefeated = cur.defeatedWindow === window ? (cur.defeated ?? []) : [];
      const defeated = decision === 'win' && guard.sealed.tile
        ? [...prevDefeated.filter((t) => t !== guard.sealed.tile), guard.sealed.tile].slice(-256)
        : prevDefeated;
      // 位置も権威 state に確定 (歩行では書かないので、戦闘のたびにここで同期 = トークン失効時の
      // 再同期先が「最後の街」でなく「直近の戦闘地点」になり、ワープを防ぐ)。tile は "x,y"。
      const [tx, ty] = guard.sealed.tile.split(',').map(Number);
      const pos = Number.isFinite(tx) && Number.isFinite(ty) ? { x: tx, y: ty } : {};
      // 戦闘をまたぐ HP/MP・消費アイテムも権威 state に反映 (負けは全快で復帰)。
      return {
        ...r.next,
        ...pos,
        carryHp: decision === 'lose' ? undefined : next.player.hp,
        carryMp: decision === 'lose' ? undefined : next.player.mp,
        herbs: next.herbs,
        tonics: next.tonics,
        defeated,
        defeatedWindow: window,
      };
    }, { now, init: (did, nowIso) => migrateInitState(did, nowIso) });
    return { state: stripState(next), events: next.lastEvents, outcome: next.outcome, awarded };
  }

  // ── 未決着: turn+1・新 pendingTurnSeed を CAS で確定してから応答 (並行二重解決/引き直しを弾く) ──
  // expiresAt も更新し、長い戦闘が move の flush 対象にならないようにする (ターンごとに寿命を延ばす)。
  const nextPending = (await entropyU32({ useKuda: true })).value;
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
