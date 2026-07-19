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
  startBattle, resolveTurn, statVectorToArray, jobLevelFromXp, playerLevelFromXp, playerCombatant, rollSearch,
  terrainAt, isWalkable, wrap, townAt, regionOf, regionDanger, tierForDanger, encounterRateFor, worldOverlay, BATTLE_TUNING,
  type BattleState, type Command, type Archetype, type StatVector, type GearSelection,
} from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readGuard, createGuard, advanceGuard, deleteGuard, type BattleGuard } from './battle-guard';
import { readState, readModifyWrite, emptyState, type GameStateEnv, type GameState } from './game-state';
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

/** ユーザーの PDS + handle を DID document から解決 (handle は alsoKnownAs の at:// から)。 */
async function resolveUserPds(userDid: string, fetchImpl?: typeof fetch): Promise<{ pds: string; handle: string }> {
  const doc = (await resolveDidDocument(userDid, fetchImpl)) as { id: string; alsoKnownAs?: string[]; service?: { id: string; type: string; serviceEndpoint: string }[] };
  const aka = doc.alsoKnownAs?.find((a) => a.startsWith('at://'));
  const handle = aka ? aka.slice('at://'.length) : userDid;
  return { pds: pdsEndpointFromDoc(doc, userDid), handle };
}

/** ユーザーの診断 (archetype + baseStats) + handle を PDS から読む。無ければ ResolverError(409)。
 *  `ns` は NSID prefix (dev は `app.aozoraquest.dev`)。edge は 1 デプロイで dev/prod を捌くので Origin から決める。 */
async function readDiagnosis(userDid: string, ns: string, fetchImpl?: typeof fetch): Promise<{ archetype: Archetype; baseStats: ReturnType<typeof statVectorToArray>; handle: string; jobXp: number; playerXp: number }> {
  const { pds, handle } = await resolveUserPds(userDid, fetchImpl);
  const rec = await getRecord<{ archetype: Archetype; rpgStats: StatVector; jobLevel?: { xp?: number }; playerLevel?: { xp?: number } }>(pds, userDid, `${ns}.analysis`, 'self');
  if (!rec?.value?.archetype || !rec.value.rpgStats) throw new ResolverError('診断が未実施 (先に気質診断が必要)', 409, 'diagnosis_required');
  // Lv は analysis を正とする (archetype/素ステと同じ)。gameState 移行は env prefix 前の古い値で固まりうるため。
  const jobXp = typeof rec.value.jobLevel?.xp === 'number' && rec.value.jobLevel.xp > 0 ? rec.value.jobLevel.xp : 0;
  const playerXp = typeof rec.value.playerLevel?.xp === 'number' && rec.value.playerLevel.xp > 0 ? rec.value.playerLevel.xp : 0;
  return { archetype: rec.value.archetype, baseStats: statVectorToArray(rec.value.rpgStats), handle, jobXp, playerXp };
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
export async function migrateInitState(userDid: string, nowIso: string, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<GameState> {
  const base = emptyState(userDid, nowIso);
  base.materials = { 'sky-feather': 1 }; // 冒険はじめに そらのはね 1 個 (困ったら街へ戻れる。Option B リセット)
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
export async function sealEncounter(env: ResolverEnv, userDid: string, state: GameState, x: number, y: number, monsterSeed: number, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<EncounterInfo> {
  const { archetype, baseStats, handle, jobXp, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const tier = tierForDanger(regionDanger(regionOf(x, y)));
  // Lv は analysis 由来 (表示と一致。gameState 移行が env prefix 前の古い値で固まる問題を回避)。
  const jobLevel = jobLevelFromXp(jobXp);
  const playerLevel = playerLevelFromXp(playerXp);
  // 戦闘ログの表示名は handle (DID ではなく)。startBattle の player 識別子に渡す。
  // 在庫は materials マップに一本化 (client と同じモデル)。やくそう=herb / そらのしずく=sky-dew。
  const battle = startBattle(archetype, jobLevel, playerLevel, handle, tier, monsterSeed, state.materials['herb'] ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats, equipIds: state.gear, gear: state.gearSel, tonics: state.materials['sky-dew'] ?? 0, vitalsVariance: BATTLE_TUNING.monsterVitalsVariance,
  });
  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const pendingTurnSeed = (await entropyU32({ useKuda: true })).value;
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
  const { archetype, baseStats, handle, jobXp, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const c = playerCombatant(archetype, jobLevelFromXp(jobXp), playerLevelFromXp(playerXp), handle, baseStats, state.gear, state.gearSel);
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

export interface SearchResult { found: string | null; materials: Record<string, number> }

/** しらべる: サーバーが luk (装備込み) + tier (位置) + 物理乱数で判定し、当たれば gameState.materials に付与。
 *  これで拾ったアイテムがサーバー在庫の正になる (client のみの幻ではなくなる)。パワー消費は当面 client 側。 */
export async function handleSearch(env: ResolverEnv, userDid: string, token: string | undefined, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<SearchResult> {
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
  const { archetype, baseStats, handle, jobXp, playerXp } = await readDiagnosis(userDid, ns, fetchImpl);
  const luk = playerCombatant(archetype, jobLevelFromXp(jobXp), playerLevelFromXp(playerXp), handle, baseStats, state.gear, state.gearSel).luk;
  const tier = tierForDanger(regionDanger(regionOf(x, y)));
  const found = rollSearch((await entropyU32({ useKuda: true })).value, luk, tier);
  if (!found) return { found: null, materials: state.materials };
  const written = await readModifyWrite(env, userDid, (cur) => ({ ...cur, materials: { ...cur.materials, [found]: (cur.materials[found] ?? 0) + 1 } }),
    { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { found, materials: written.materials };
}

/** 装備ミラー: client が解決した GearSelection (強化値つき) を gameState に保存 (戦闘に反映)。
 *  forgeable だが §6-4 dev 無害・archetype と同じ信用レベル (M5 で再検討)。 */
export async function handleGear(env: ResolverEnv, userDid: string, gear: GearSelection, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch): Promise<{ ok: true }> {
  await readModifyWrite(env, userDid, (cur) => ({ ...cur, gearSel: gear }), { now, init: (d, iso) => migrateInitState(d, iso, ns, fetchImpl) });
  return { ok: true };
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
export async function handleTurn(env: ResolverEnv, userDid: string, battleId: string, turn: number, command: Command, now: number, ns: string = DEFAULT_NS): Promise<TurnResult> {
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
        luk: next.player.luk, rewardSeed, lossSeed, rewarded: guard.rewarded,
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
