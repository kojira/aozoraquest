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
  startBattle, resolveTurn, resolveTurnMulti, statVectorToArray, JOBS_BY_ID, normalizeStats, jobLevelFromXp, playerLevelFromXp, playerCombatant, rollSearch, dropBonusOf,
  terrainAt, isWalkable, wrap, townAt, regionOf, tierForRegion, encounterRateFor, worldOverlay, BATTLE_TUNING, type Tier,
  type BattleState, type Command, type Archetype, type StatVector, type GearSelection,
} from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readGuard, createGuard, advanceGuard, deleteGuard, type BattleGuard } from './battle-guard';
import { readState, readModifyWrite, emptyState, rkeyForDid, GAME_STATE_COLLECTION, type GameStateEnv, type GameState } from './game-state';
import { SEARCH_POWER_COST, MAX_SHOP_OPS } from './shop';
import type { OwnedPiece } from './game-state';
import { serverDeleteRecord } from './server-pds';
import { signPosition, verifyPosition, enemyWindow, tileEncounter } from './world-token';
import { applyBattleOutcome, type AwardBreakdown, type BattleDecision } from './battle-reward';
import { resolveDidDocument } from './service-auth';
import { pdsEndpointFromDoc } from './oauth-metadata';
import { getRecord, PdsError } from './pds';

/** NSID の既定 prefix (本番)。dev は `app.aozoraquest.dev`。edge は 1 デプロイで dev/prod を捌くので、
 *  リクエストの Origin から prefix を決めて渡す (#363)。既定=本番なのでテスト/既存呼び出しは従来通り。 */
export const DEFAULT_NS = 'app.aozoraquest';
export const VALID_COMMANDS: readonly Command[] = ['attack', 'guard', 'skill', 'herb', 'tonic', 'flee'];

/** 戦闘解決に必要な env (権威 state 読み書き + ユーザー診断 fetch)。 */
export type ResolverEnv = GameStateEnv;

/** ガードに封印する startBattle 由来のメタ (turn では state を使うが、報酬/撃破記録用に残す)。 */
interface SealedMeta {
  archetype: string;
  tier: Tier;
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

/** ユーザーの PDS + handle を DID document から解決 (handle は alsoKnownAs の at:// から)。 */
export async function resolveUserPds(userDid: string, fetchImpl?: typeof fetch): Promise<{ pds: string; handle: string }> {
  const doc = (await resolveDidDocument(userDid, fetchImpl)) as { id: string; alsoKnownAs?: string[]; service?: { id: string; type: string; serviceEndpoint: string }[] };
  const aka = doc.alsoKnownAs?.find((a) => a.startsWith('at://'));
  const handle = aka ? aka.slice('at://'.length) : userDid;
  return { pds: pdsEndpointFromDoc(doc, userDid), handle };
}

/** ユーザーの診断 (archetype + baseStats) + handle を PDS から読む。無ければ ResolverError(409)。
 *  `ns` は NSID prefix (dev は `app.aozoraquest.dev`)。edge は 1 デプロイで dev/prod を捌くので Origin から決める。 */
async function readDiagnosis(userDid: string, ns: string, fetchImpl?: typeof fetch): Promise<{ archetype: Archetype; baseStats: ReturnType<typeof statVectorToArray>; handle: string; playerXp: number }> {
  const { pds, handle } = await resolveUserPds(userDid, fetchImpl);
  const rec = await getRecord<{ archetype: Archetype; rpgStats: StatVector; jobLevel?: { xp?: number }; playerLevel?: { xp?: number } }>(pds, userDid, `${ns}.analysis`, 'self');
  if (!rec?.value?.archetype || !rec.value.rpgStats) throw new ResolverError('診断が未実施 (先に気質診断が必要)', 409, 'diagnosis_required');
  // **実在する職か確かめる** (#551)。ここが無いと、ユーザーが自分の PDS に書いた任意の
  // 文字列がそのまま職として使われ、`JOB_KITS[archetype]` 等が undefined を返して
  // 「とくぎが 1 つも無い」「パッシブが効かない」といった無言の壊れ方をする。
  if (!(rec.value.archetype in JOBS_BY_ID)) throw new ResolverError('職が不正 (診断をやり直して)', 409, 'invalid_archetype');
  // **ジョブ XP はここから読まない** (#534)。XP の記録先は権威 state (`GameState.jobXp`) に
  // 一本化した。`analysis.jobLevel.xp` はベータ期間の記録として凍結され、成長には効かない。
  //
  // **素ステはサーバーで正規化し直す** (#551 段階 3)。`analysis` はユーザー自身の PDS に
  // あり本人が自由に書けるので、そのまま信じると `{atk: 9999, ...}` で戦闘力を盛れた。
  // 正当な診断結果は `computeStats` が最後に `normalizeStats` を通すので**必ず合計 100**
  // になる。同じ正規化をここでも掛ければ、**形 (どのステに寄っているか = 診断の結果) は
  // 残り、大きさだけ盛れなくなる**。サーバーが投稿から診断をやり直すまでの間、
  // これで「盛る」経路は実質閉じる。
  const playerXp = typeof rec.value.playerLevel?.xp === 'number' && rec.value.playerLevel.xp > 0 ? rec.value.playerLevel.xp : 0;
  return { archetype: rec.value.archetype, baseStats: statVectorToArray(normalizeStats(sanitizeStatVector(rec.value.rpgStats))), handle, playerXp };
}

/** 数値でない/負/非有限を 0 に倒してから正規化に渡す (`normalizeStats` は数値を前提にしている)。 */
function sanitizeStatVector(v: StatVector): StatVector {
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
  return { atk: n(v?.atk), def: n(v?.def), agi: n(v?.agi), int: n(v?.int), luk: n(v?.luk) };
}

/** 権威 state から、その職の累計 XP を読む (#534)。戦闘・表示・報酬がすべてここを見る。 */
export function jobXpOf(state: GameState, archetype: string): number {
  const v = state.jobXp[archetype];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export const POWER_COLLECTION = 'app.aozoraquest.power';

/** §6-4 移行の上限クランプ (偽造済みかもしれない PDS 現値を切り詰める)。**dev=owner は無害・一般ユーザー
 *  移行は M5 で再検討 (§9-4 未解決)**。真の偽造対策は M4 の投稿 XP 権威化で、これは絶対値の暴走を切る
 *  緩いサニティ上限。長期ユーザーの正当残高 (viaPosts 累積) を切り詰めない大きさにする。値の根拠はコミット参照。 */
export const MAX_MIGRATE_POWER = 100_000; // 正当ユーザー (投稿数=残高上限) を十分上回る緩い上限
export const MAX_MIGRATE_PLAYER_XP = 500_000; // lvl 99 ≈ 457k を上回る安全上限

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
export async function migrateInitState(userDid: string, nowIso: string, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<GameState> {
  const base = emptyState(userDid, nowIso);
  // 冒険はじめの持ち物: やくそう 1 (最初の回復) + そらのはね 1 (困ったら街へ戻れる)。
  base.materials = { herb: 1, 'sky-feather': 1 };
  try {
    const { pds } = await resolveUserPds(userDid, fetchImpl);
    const [powerRec, analysisRec, worldRec] = await Promise.all([
      getRecord<MigratablePowerRecord>(pds, userDid, `${ns}.power`, 'self').catch(() => null),
      getRecord<MigratableAnalysisRecord>(pds, userDid, `${ns}.analysis`, 'self').catch(() => null),
      getRecord<MigratableWorldRecord>(pds, userDid, `${ns}.world`, 'self').catch(() => null),
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
      // **ジョブ XP は取り込まない** (#534)。XP を権威 state に一本化するにあたり、
      // ベータの区切りとして全員 Lv1 から再スタートする (オーナー判断 2026-07-26)。
      // ここで取り込むと、投稿由来の XP が新方式の申告と足し合わさって二重に効く。
      // 過去の到達レベルは analysis.jobLevel.xp に残り、/me の記録として表示する。
    }
  } catch { /* 読めない/未診断は power 0・Lv1 で開始 (読取のみ = 無害) */ }
  return base;
}

/**
 * オンボード用リセット: サーバー権威データ (gameState + 戦闘ガード) を消す。
 * 次の move/state で migrateInitState が走り、初期状態 (spawn + やくそう&そらのはね + Lv1) から再開する。
 * client 側の PDS レコード (制作/装備/世界/パワー/分析XP) の初期化は client が本人トークンで行う
 * (自分の repo は本人が書ける)。ここはユーザーが書けない権威データだけを担当する。
 * **認証済み本人 (userDid) の state しか消せない** = 破壊範囲は呼び出し本人に限定 (他人を初期化できない)。
 */
export async function handleReset(env: ResolverEnv, userDid: string, now: number): Promise<{ ok: true }> {
  // 進行中の戦闘ガードがあれば破棄 (未報酬なので二重報酬にはならない)。
  const guard = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (guard) await deleteGuard(env, now, userDid, guard.cid);
  // gameState レコードを削除 → 次の move/state で migrateInitState が初期状態を生成する。
  const existing = await readState(env, userDid);
  if (existing) await serverDeleteRecord(env, now, GAME_STATE_COLLECTION, rkeyForDid(userDid), existing.cid);
  return { ok: true };
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
export async function sealEncounter(env: ResolverEnv, userDid: string, state: GameState, x: number, y: number, monsterSeed: number, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<EncounterInfo> {
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const tier = tierForRegion(regionOf(x, y));
  // Lv は権威 state 由来 (#534)。戦闘で使うレベルと、報酬を積む先が同じレコードになる。
  const jobLevel = jobLevelFromXp(jobXpOf(state, archetype), archetype);
  const playerLevel = playerLevelFromXp(playerXp);
  // 戦闘ログの表示名は handle (DID ではなく)。startBattle の player 識別子に渡す。
  // 在庫は materials マップに一本化 (client と同じモデル)。やくそう=herb / そらのしずく=sky-dew。
  const battle = startBattle(archetype, jobLevel, playerLevel, handle, tier, monsterSeed, state.materials['herb'] ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats, gear: state.gearSel, tonics: state.materials['sky-dew'] ?? 0, vitalsVariance: BATTLE_TUNING.monsterVitalsVariance,
  });
  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const pendingTurnSeed = (await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value;
  const battleId = 'b' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const nowIso = new Date(now * 1000).toISOString();
  // move では毎歩ガードを読まない (ステートレス高速化)。**client は戦闘中は move しない**ので、ここに
  // 来た時点で既存ガードは必ず孤立 (戦闘を終えず離脱した残骸)。期限内でも破棄して新しい遭遇を成立させる。
  // これをしないと、離脱後にエンカウントタイル (30分固定=特定の場所) を踏むたび createGuard が InvalidSwap
  // → 500「移動できなかった」で詰まる。孤立ガードの戦闘は未報酬なので破棄しても二重報酬にならない。
  const existing = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (existing) await deleteGuard(env, now, userDid, existing.cid);
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
export async function handleMove(env: ResolverEnv, userDid: string, dx: number, dy: number, token: string | undefined, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<MoveResult> {
  if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy) || (dx === 0 && dy === 0)) throw new ResolverError('不正な移動 (隣接1マスのみ)', 400);

  // 現在位置: 署名トークンが権威。無効/失効なら gameState から再同期 (位置偽造は署名で不可)。
  let cx: number, cy: number, counter = 0;
  try {
    const claim = verifyPosition(env, token ?? '', userDid, now);
    cx = claim.x; cy = claim.y; counter = claim.counter;
  } catch {
    const rec = await readState(env, userDid);
    const s = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
    cx = s.x; cy = s.y;
  }

  const nx = wrap(cx + dx), ny = wrap(cy + dy);
  const terrain = terrainAt(nx, ny);
  if (!isWalkable(terrain)) throw new ResolverError('進めない地形', 400);

  let healed = false;
  if (terrain === 'town') {
    // 街: HP/MP 全回復 + 位置 + 最後の街 (敗北帰還先) を gameState に確定 (稀なので PDS 書き OK)。
    await readModifyWrite(env, userDid, (cur) => ({ ...cur, x: nx, y: ny, carryHp: undefined, carryMp: undefined, lastTown: { x: nx, y: ny } }),
      { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
    healed = true;
  }

  const nextToken = signPosition(env, { did: userDid, x: nx, y: ny, counter: counter + 1, iat: now });

  // エンカウント: tile+30分枠+秘密から決定的 (見えない・予測不可・30分でリポップ)。街では出さない。
  if (terrain !== 'town') {
    const window = enemyWindow(now);
    const { roll, monsterSeed } = tileEncounter(env, nx, ny, window);
    if (roll < encounterRateFor(terrain)) {
      const rec = await readState(env, userDid);
      const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
      // その 30 分枠で撃破済みのタイルには敵が居ない (同一敵の無限狩り防止)。
      const defeated = state.defeatedWindow === window ? (state.defeated ?? []) : [];
      if (!defeated.includes(`${nx},${ny}`)) {
        const encounter = await sealEncounter(env, userDid, state, nx, ny, monsterSeed, now, ns, fetchImpl);
        return { x: nx, y: ny, terrain, token: nextToken, encounter };
      }
    }
  }
  return { x: nx, y: ny, terrain, healed: healed || undefined, token: nextToken };
}

export interface TeleportResult { x: number; y: number; token: string; materials: Record<string, number> }

/**
 * そらのはねワープ: 街タイルへテレポートし、権威位置 + トークンを更新する (client だけで飛ぶと 1 歩で
 * サーバーの旧位置に戻される)。**街タイルのみ許可**なので高tier地帯への任意ワープはできない (街=安全地帯)。
 * 全回復 + lastTown 更新 (街到着なので)。孤立ガードがあれば破棄。消費 (そらのはね) は当面 client 側 (#372)。
 */
export async function handleTeleport(env: ResolverEnv, userDid: string, x: number, y: number, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<TeleportResult> {
  const tx = wrap(x), ty = wrap(y);
  if (!townAt(tx, ty)) throw new ResolverError('そこは街ではない (そらのはねは街へのみ)', 400);
  const g = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (g) await deleteGuard(env, now, userDid, g.cid); // 念のため孤立ガードを破棄
  // そらのはね (sky-feather) をサーバー在庫から 1 消費。持っていなければ 400。全回復 + lastTown 更新。
  let materials: Record<string, number> = {};
  const written = await readModifyWrite(env, userDid, (cur) => {
    const have = cur.materials['sky-feather'] ?? 0;
    if (have <= 0) throw new ResolverError('そらのはねを もっていない', 400);
    const m: Record<string, number> = { ...cur.materials };
    m['sky-feather'] = have - 1;
    if (m['sky-feather'] <= 0) delete m['sky-feather'];
    return { ...cur, x: tx, y: ty, carryHp: undefined, carryMp: undefined, lastTown: { x: tx, y: ty }, materials: m };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  materials = written.materials;
  const token = signPosition(env, { did: userDid, x: tx, y: ty, counter: 0, iat: now });
  return { x: tx, y: ty, token, materials };
}

export interface ItemResult { carryHp?: number; carryMp?: number; materials: Record<string, number>; healed: number }

/** フィールドの道具使用 (やくそう=herb / そらのしずく=tonic)。サーバー在庫を 1 消費して carryHp/Mp を回復。
 *  maxHp/Mp はプレイヤーの archetype+Lv+装備から算出 (playerCombatant)。満タン/在庫切れは 400。 */
export async function handleItem(env: ResolverEnv, userDid: string, item: 'herb' | 'tonic', now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<ItemResult> {
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const matId = item === 'herb' ? 'herb' : 'sky-dew';
  if ((state.materials[matId] ?? 0) <= 0) throw new ResolverError(item === 'herb' ? 'やくそうを もっていない' : 'そらのしずくを もっていない', 400);
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const c = playerCombatant(archetype, jobLevelFromXp(jobXpOf(state, archetype), archetype), playerLevelFromXp(playerXp), handle, baseStats, undefined, state.gearSel);
  let healed = 0;
  const written = await readModifyWrite(env, userDid, (cur) => {
    const have = cur.materials[matId] ?? 0;
    if (have <= 0) throw new ResolverError('在庫切れ', 400);
    const m = { ...cur.materials, [matId]: have - 1 };
    if ((m[matId] ?? 0) <= 0) delete m[matId];
    if (item === 'herb') {
      const curHp = cur.carryHp ?? c.maxHp;
      if (curHp >= c.maxHp) throw new ResolverError('HP は満タン', 400);
      const newHp = Math.min(c.maxHp, curHp + Math.round(c.maxHp * BATTLE_TUNING.herbHealRatio));
      healed = newHp - curHp;
      return { ...cur, materials: m, carryHp: newHp >= c.maxHp ? undefined : newHp };
    }
    const curMp = cur.carryMp ?? c.maxMp;
    if (curMp >= c.maxMp) throw new ResolverError('MP は満タン', 400);
    const newMp = Math.min(c.maxMp, curMp + Math.max(1, Math.round(c.maxMp * BATTLE_TUNING.tonicMpRatio)));
    healed = newMp - curMp;
    return { ...cur, materials: m, carryMp: newMp >= c.maxMp ? undefined : newMp };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { carryHp: written.carryHp, carryMp: written.carryMp, materials: written.materials, healed };
}

/** 権威 state + 診断から luk (装備込み) を出す。**client 申告を使わない** —
 *  強化値の抽選に luk が効くので、client の値を信じると盛れる (#551)。 */
export async function playerLuk(env: ResolverEnv, userDid: string, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<number> {
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date().toISOString(), ns, fetchImpl));
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  return playerCombatant(archetype, jobLevelFromXp(jobXpOf(state, archetype), archetype), playerLevelFromXp(playerXp), handle, baseStats, undefined, state.gearSel).luk;
}

export interface SearchResult { found: string | null; materials: Record<string, number>; power: number }

/** しらべる: サーバーが luk (装備込み) + tier (位置) + 物理乱数で判定し、当たれば gameState.materials に付与。
 *  これで拾ったアイテムがサーバー在庫の正になる (client のみの幻ではなくなる)。
 *  **パワーの消費も権威側** (#551) — client の台帳だけで引いていた頃は、いくらでも しらべられた。 */
export async function handleSearch(env: ResolverEnv, userDid: string, token: string | undefined, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch, opKey?: string): Promise<SearchResult> {
  let x: number, y: number;
  try {
    const c = verifyPosition(env, token ?? '', userDid, now);
    x = c.x; y = c.y;
  } catch {
    const rec = await readState(env, userDid);
    const s = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
    x = s.x; y = s.y;
  }
  const rec = await readState(env, userDid);
  const state = rec?.state ?? (await migrateInitState(userDid, new Date(now * 1000).toISOString(), ns, fetchImpl));
  const { archetype, baseStats, handle, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const luk = playerCombatant(archetype, jobLevelFromXp(jobXpOf(state, archetype), archetype), playerLevelFromXp(playerXp), handle, baseStats, undefined, state.gearSel).luk;
  const tier = tierForRegion(regionOf(x, y));
  // **パワーは権威側から引く** (#551)。それまで消費は client の台帳だけで、権威 state の
  // power は動いていなかった = いくらでも しらべられた。
  if (state.power < SEARCH_POWER_COST) throw new ResolverError('あおぞらパワーが たりない', 400, 'no_power');
  const found = rollSearch((await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value, luk, tier);
  // **冪等キー** (#551 レビュー指摘)。応答だけ落ちて client が押し直すと、無キーだと
  // 権威側は 2 回引かれるのに画面は 1 回ぶんしか反映されない = 「パワーが勝手に消えた」。
  const key = opKey ? `search:${opKey}` : null;
  const written = await readModifyWrite(env, userDid, (cur) => {
    if (key && (cur.shopOps ?? []).includes(key)) return cur; // 処理済み: 何も引かない
    // 再読み込み後にも残高を確かめる (CAS リトライで別の消費が割り込みうる)。
    if (cur.power < SEARCH_POWER_COST) throw new ResolverError('あおぞらパワーが たりない', 400, 'no_power');
    const materials = found ? { ...cur.materials, [found]: (cur.materials[found] ?? 0) + 1 } : cur.materials;
    return {
      ...cur,
      power: cur.power - SEARCH_POWER_COST,
      materials,
      ...(key ? { shopOps: [...(cur.shopOps ?? []), key].slice(-MAX_SHOP_OPS) } : {}),
    };
  }, { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { found, materials: written.materials, power: written.power };
}

/** 装備ミラー: client が解決した GearSelection (強化値つき) を gameState に保存 (戦闘に反映)。
 *  forgeable だが §6-4 dev 無害・archetype と同じ信用レベル (M5 で再検討)。 */
export async function handleGear(env: ResolverEnv, userDid: string, gear: GearSelection, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<{ ok: true }> {
  await readModifyWrite(env, userDid, (cur) => ({ ...cur, gearSel: sanitizeGear(gear, cur.pieces ?? []) }),
    { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { ok: true };
}

/**
 * **所持している個体だけを装備として通す** (#551 段階 2)。
 *
 * それまでは client が送ってきた `GearSelection` を無検証で保存していたので、
 * `{ weapon: { id: 'wp-shogun-high', level: 99 } }` を POST するだけで戦闘に効いた
 * (PDS のレコードを偽造する必要すらなかった)。所持個体は `/api/shop/craft` と
 * `/api/shop/forge` だけが作るので、ここで突き合わせれば持っていない装備は着られない。
 *
 * スロットと品の種別が合うかは core の `gearBonusFromGear` が既に見ているので、
 * ここでは**所持と強化値**だけを正す。
 */
export function sanitizeGear(gear: GearSelection, owned: readonly OwnedPiece[]): GearSelection {
  const out: GearSelection = {};
  for (const slot of ['weapon', 'armor', 'charm'] as const) {
    const sel = gear?.[slot];
    if (!sel) continue;
    // 文字列指定 (旧形式) は個体を特定できない。その品を持っていれば**最低の強化値**で通す。
    const wantId = typeof sel === 'string' ? sel : sel.id;
    const wantLevel = typeof sel === 'string' ? undefined : sel.level;
    const mine = owned.filter((p) => p.itemId === wantId);
    if (mine.length === 0) continue; // 持っていない = 装備できない
    // 強化値の指定があるなら、その値の個体を実際に持っているときだけ通す。
    const hit = wantLevel === undefined
      ? mine.reduce((a, b) => (a.level <= b.level ? a : b))
      : mine.find((p) => p.level === wantLevel);
    if (!hit) continue;
    out[slot] = { id: hit.itemId, level: hit.level };
  }
  return out;
}

export interface TurnResult {
  state: Omit<BattleState, 'seed'>;
  events: BattleState['lastEvents'];
  outcome: BattleState['outcome'];
  awarded?: AwardBreakdown;
  /** 決着後の権威位置 (敗北は最後の街へ帰還)。client はここへ移動。 */
  position?: { x: number; y: number };
  /** 決着後の位置に対応する新しい署名トークン (敗北帰還で位置が変わるため)。 */
  token?: string;
  /** 決着後の権威在庫/HP (client は表示をこれで同期。materials 一本化 = やくそう herb / しずく sky-dew)。 */
  materials?: Record<string, number>;
  carryHp?: number;
  carryMp?: number;
}

/**
 * turn: 1 コマンドを**サーバーが**確定 pendingTurnSeed で解決する。
 * 決着なら報酬を fail-closed で確定 + ガード削除。未決着なら CAS で turn を進めてから応答。
 */
export async function handleTurn(env: ResolverEnv, userDid: string, battleId: string, turn: number, command: Command, now: number, ns: string = DEFAULT_NS, skillIndex = 0, targetIndex = 0): Promise<TurnResult> {
  if (!VALID_COMMANDS.includes(command)) throw new ResolverError('不正なコマンド', 400);
  const g = await readGuard<SealedMeta, BattleState>(env, userDid);
  if (!g) throw new ResolverError('戦闘中でない', 409);
  const { guard, cid } = g;
  // battleId / turn 不一致 = リプレイ/やり直し → 409 (応答しない)。
  if (guard.battleId !== battleId || guard.turn !== turn) throw new ResolverError('ターン不一致 (やり直し/リプレイ)', 409);

  // とくぎ選択 (#436) はサーバー権威の sealed state で検証: 実際に習得済みのとくぎだけ選べる
  // (client が持っていない index を偽っても署名スキル [0] に落とす。詐称防止)。
  const skills = guard.state.playerSkills ?? [guard.state.playerSkill];
  const idx = Number.isInteger(skillIndex) && skillIndex >= 0 && skillIndex < skills.length ? skillIndex : 0;
  // 群れ (#453): enemies が 2 体以上なら resolveTurnMulti で解決 + targetIndex を検証。1 体 (従来) は
  // resolveTurn (1v1・挙動不変)。client が偽った targetIndex は敵配列の範囲に clamp、範囲外/非整数は
  // 主敵 [0] に落とす (詐称防止の fail-safe。死体を指定しても core の resolveTargets が空振りにする)。
  const enemies = guard.state.enemies;
  const isMulti = (enemies?.length ?? 0) > 1;
  const tIdx = isMulti && Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < enemies!.length ? targetIndex : 0;
  const next = isMulti
    ? resolveTurnMulti(guard.state, command, guard.pendingTurnSeed, idx, tIdx)
    : resolveTurn(guard.state, command, guard.pendingTurnSeed, idx);

  if (next.outcome !== 'ongoing') {
    // ── 決着: **まずガードを CAS 削除して「この決着ターンは自分が消費」を確定** ──
    // これで並行/リプレイの重複リクエストは InvalidSwap → 409 になり、報酬確定に到達できるのは
    // ガードを消せた 1 リクエストだけ = **二重報酬を防ぐ** (applyBattleOutcome は加算なので必須。§4.1c 冪等)。
    // token 切れで delete が失敗 → ServerWriteError が伝播し上位で 503 (報酬なし・guard 残る=リトライ可、
    // fail-closed)。この順序 (消費確定 → 報酬) が §4.1 の「CAS で先に確定 → その後 resolve/確定」。
    // next.outcome は上の `!== 'ongoing'` で BattleDecision に絞り込み済み (キャスト不要 = 網羅を型で保証)。
    const decision: BattleDecision = next.outcome;
    try {
      await deleteGuard(env, now, userDid, cid);
    } catch (e) {
      if (e instanceof PdsError && e.xrpcError === 'InvalidSwap') throw new ResolverError('決着競合 (二重確定防止)', 409);
      throw e; // ServerWriteError(token 切れ) 等 → 上位で 503 (報酬なし)
    }
    // ここに来られるのはガードを消せた 1 リクエストだけ → 報酬を fail-closed で確定。
    const rewardSeed = (await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value;
    const lossSeed = (await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value;
    let awarded: AwardBreakdown = {};
    let finalPos = { x: 0, y: 0 };
    const window = enemyWindow(now);
    const written = await readModifyWrite(env, userDid, (cur: GameState): GameState => {
      // 戦闘中に消費したやくそう/しずくを materials に反映してから報酬 (ドロップ/ロス) を適用。
      const consumedMaterials = { ...cur.materials };
      const setCount = (id: string, n: number) => { if (n > 0) consumedMaterials[id] = n; else delete consumedMaterials[id]; };
      setCount('herb', next.herbs ?? 0);
      setCount('sky-dew', next.tonics ?? 0);
      const r = applyBattleOutcome({ ...cur, materials: consumedMaterials }, {
        outcome: decision, monsterId: next.monsterId, archetype: guard.sealed.archetype,
        luk: next.player.luk, dropBonus: dropBonusOf(next.player), rewardSeed, lossSeed, rewarded: guard.rewarded,
        // 群れ (#453): **倒した敵 (hp<=0) ぶんだけ**報酬。maxTurns 勝ち (HP 比で win・敵が生存) のとき
        // 生存敵に報酬を出さない (レビュー ★★)。全滅勝ちなら全敵が hp<=0 で全頭ぶん。1 体戦は monsterId 単体。
        ...(isMulti ? { enemyIds: next.enemies!.filter((e) => e.hp <= 0).map((e) => e.monsterId ?? next.monsterId) } : {}),
      });
      awarded = r.awarded;
      // 勝ったらそのタイルを「撃破済み」に記録し、同じ 30 分枠では再エンカウントさせない (無限狩り防止)。
      const prevDefeated = cur.defeatedWindow === window ? (cur.defeated ?? []) : [];
      const defeated = decision === 'win' && guard.sealed.tile
        ? [...prevDefeated.filter((t) => t !== guard.sealed.tile), guard.sealed.tile].slice(-256)
        : prevDefeated;
      // 位置を権威 state に確定。**敗北は最後の街へ帰還** (無ければ spawn)。勝ち/引き分けは戦闘タイルに留まる。
      const [tx, ty] = guard.sealed.tile.split(',').map(Number);
      const battleTile = Number.isFinite(tx) && Number.isFinite(ty) ? { x: tx, y: ty } : { x: cur.x, y: cur.y };
      const spawn = worldOverlay().spawn;
      finalPos = decision === 'lose' ? (cur.lastTown ?? { x: spawn.x, y: spawn.y }) : battleTile;
      return {
        ...r.next,
        x: finalPos.x,
        y: finalPos.y,
        // **レベルアップ時の全回復はここには入れない** (#547)。入れて実測したところ、
        // tier1 の連戦数が平均 9.1 → 46.7 戦 (5.1 倍) に伸び、隊長/将軍は上限なしだと
        // 876〜941 戦 = 事実上無限になった (「上がる → 全快 → 長く生きる → XP が増える →
        // また上がる」の正のフィードバック)。#536 で連戦数から決めた monsterStatFloor と
        // JOB_LEVEL_PACE の前提が壊れるので、係数の引き直しとセットで別途入れる。
        carryHp: decision === 'lose' ? undefined : next.player.hp,
        carryMp: decision === 'lose' ? undefined : next.player.mp,
        defeated,
        defeatedWindow: window,
      };
    }, { now, init: (did, nowIso) => migrateInitState(did, nowIso, ns) });
    // 決着後の位置に対応する新トークンを発行 (敗北帰還で位置が変わるので client はこれで同期)。
    const token = signPosition(env, { did: userDid, x: finalPos.x, y: finalPos.y, counter: 0, iat: now });
    return { state: stripState(next), events: next.lastEvents, outcome: next.outcome, awarded, position: finalPos, token,
      materials: written.materials, carryHp: written.carryHp, carryMp: written.carryMp };
  }

  // ── 未決着: turn+1・新 pendingTurnSeed を CAS で確定してから応答 (並行二重解決/引き直しを弾く) ──
  // expiresAt も更新し、長い戦闘が move の flush 対象にならないようにする (ターンごとに寿命を延ばす)。
  const nextPending = (await entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY })).value;
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
