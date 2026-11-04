/**
 * 遭遇の組み立てと封印 (sealEncounter)。battle-resolver.ts から移した (800 行の上限。D-PARTY-001)。
 * パーティの仲間 (GameState.party) を allies に並べる。ボスの強さは章の想定人数で合わせてあるので、仲間の数で HP を変えない (D-PARTY-002 §12)。
 * 台本負け (scripted) は 1 対 1 のまま (仲間は加わらない)。
 */
import {
  startBattle, battleItemsFrom, jobLevelFromXp, playerLevelFromXp, partyCapacity, partyDefsOf, partyMembers, recruitById,
  wrap, regionOf, tierForRegion, worldOverlay, BATTLE_TUNING, type Tier,
  type BattleState,
  WORLD_MAP_ID, WORLD_SIZE,
  interiorById,
  type StoryBattleDef,
} from '@aozoraquest/core';
import { entropyU32 } from './kuda';
import { readGuard, createGuard, advanceGuard, type BattleGuard } from './battle-guard';
import type { GameState, PartyState } from './game-state';
import { DEFAULT_NS, jobXpOf, readDiagnosis, type ResolverEnv } from './battle-resolver';

/** ガードに封印する startBattle 由来のメタ (turn では state を使うが、報酬/撃破記録用に残す)。 */
/** 遭遇タイルのキー。**mapId を含める** — フィールドと内部の同じ座標を別のマスとして扱う。
 *  フィールドは従来どおり "x,y" (旧ガード・旧 defeated と互換)。 */
export function tileKey(mapId: string, x: number, y: number): string {
  return mapId === WORLD_MAP_ID ? `${x},${y}` : `${mapId}:${x},${y}`;
}

/** tileKey の逆。旧形式 ("x,y") も読める。 */
export function parseTileKey(key: string): { mapId: string; x: number; y: number } | null {
  const colon = key.lastIndexOf(':');
  const mapId = colon >= 0 ? key.slice(0, colon) : WORLD_MAP_ID;
  const [x, y] = key.slice(colon + 1).split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { mapId, x: x!, y: y! };
}

export interface SealedMeta {
  archetype: string;
  tier: Tier;
  /** 遭遇したタイル "x,y" (撃破時に defeated へ入れ、その枠で再エンカウントさせない)。 */
  tile: string;
  /** 遭遇したマップ (#424)。**決着で位置を書き戻すときに要る** — 内部マップで
   *  戦って mapId を落とすと、内部ローカル座標のままフィールドに放り出される。
   *  省略 = フィールド (旧ガードとの互換)。 */
  mapId?: string;
  /** 遭遇時の素ステ。**決着でレベルアップの内訳を出すために封じておく** —
   *  ここに無いと handleTurn が診断を読み直すことになり、決着のたびに PDS 往復が増える。 */
  baseStats?: number[];
  /** ストーリー戦 (D-STORY-009)。決着で立てるフラグを封印時に固定する (定義の読み込みを待たない)。 */
  story?: { battleId: string; winFlag: string; loseFlag?: string };
  /** 戦闘に出た仲間の id (allies[1..] の順。D-PARTY-001)。決着で HP/MP を持ちこす先。 */
  party?: string[];
  /** 封印の時点で めいれい だった仲間の id (D-PARTY-004)。handleTurn の allies[] はこの人だけ。 */
  manual?: string[];
}

export type Guard = BattleGuard<SealedMeta, BattleState>;

/** client 向けに BattleState から内部 seed を除去 (先読み防止 #348)。 */
export function stripState(s: BattleState) {
  const { seed: _seed, ...rest } = s;
  return rest;
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
export async function sealEncounter(env: ResolverEnv, userDid: string, state: GameState, x: number, y: number, monsterSeed: number, now: number, ns: string = DEFAULT_NS, fetchImpl?: typeof fetch, mapId: string = WORLD_MAP_ID, story?: StoryBattleDef): Promise<EncounterInfo> {
  // 互いに依存しない外部往復 (診断 / kuda / 既存ガード) は同時に始める。直列だと遭遇する一歩だけ
  // 応答が数百 ms〜秒遅れ、client の次の歩行が止まって「引っかかる」。
  // 失敗は従来の順 (診断 → kuda → ガード) で返す = 診断未実施はガードの読みに失敗しても 409。
  const [diag, seed, guardRead] = await Promise.allSettled([
    readDiagnosis(userDid, ns, fetchImpl),
    entropyU32({ useKuda: true, apiKey: env.KUDA_API_KEY }),
    readGuard<SealedMeta, BattleState>(env, userDid),
  ]);
  if (diag.status === 'rejected') throw diag.reason;
  if (seed.status === 'rejected') throw seed.reason;
  if (guardRead.status === 'rejected') throw guardRead.reason;
  const { archetype, baseStats, handle, playerXp } = diag.value;
  const pendingTurnSeed = seed.value.value;
  const existing = guardRead.value;
  // 内部マップ (#424) は座標が 0〜127 のローカル系で region が常に 0 になるため、
  // 地域から tier を引くと**どの危険度を選んでも tier1 の敵しか出ない**。設定値を使う。
  const interior = mapId !== WORLD_MAP_ID ? interiorById(mapId) : undefined;
  const tier = (interior?.encounterTier ?? tierForRegion(regionOf(x, y))) as ReturnType<typeof tierForRegion>;
  // Lv は権威 state 由来 (#534)。戦闘で使うレベルと、報酬を積む先が同じレコードになる。
  const jobLevel = jobLevelFromXp(jobXpOf(state, archetype), archetype);
  const playerLevel = playerLevelFromXp(playerXp);
  // 戦闘ログの表示名は handle (DID ではなく)。startBattle の player 識別子に渡す。
  // 在庫は materials マップに一本化 (client と同じモデル)。やくそう=herb / そらのしずく=sky-dew。
  // ふたばの近辺だけ初回依頼の敵に揃える。通常移動の遭遇のみで、確率/内部/ボスは変えない。
  const spawn = worldOverlay().spawn;
  const distance = (a: number, b: number) => Math.min(wrap(a - b), WORLD_SIZE - wrap(a - b));
  const nearFutaba = mapId === WORLD_MAP_ID && Math.max(distance(x, spawn.x), distance(y, spawn.y)) <= 8;
  const battle = startBattle(archetype, jobLevel, playerLevel, handle, tier, monsterSeed, state.materials['herb'] ?? 0, { hp: state.carryHp, mp: state.carryMp }, {
    baseStats, gear: state.gearSel, tonics: state.materials['sky-dew'] ?? 0, battleItems: battleItemsFrom(state.materials), vitalsVariance: BATTLE_TUNING.monsterVitalsVariance,
    // ストーリー戦は定義の敵で固定 (ふたばの近くでも)。同じ敵を count 体。
    // 群れ (D-PARTY-001) はパーティを組めるようになってから (partyCapacity > 1 = futaba_letter_done)。ふたばの近くとストーリー戦は今のまま。
    ...(story ? { monsterId: story.monsterId, extraEnemies: story.count - 1, story: { canFlee: story.canFlee !== false, ...(story.scripted ? { scripted: true } : {}) } } : nearFutaba ? { monsterId: 'sky-slime' } : partyCapacity(state.flags ?? []) > 1 ? { group: true } : {}),
  });
  const party = story?.scripted ? [] : joinParty(battle, state, jobLevel);
  const rewarded = state.power >= BATTLE_TUNING.powerCost;
  const battleId = 'b' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const nowIso = new Date(now * 1000).toISOString();
  // move では毎歩ガードを読まない (ステートレス高速化)。**client は戦闘中は move しない**ので、ここに
  // 来た時点で既存ガードは必ず孤立 (戦闘を終えず離脱した残骸)。期限内でも破棄して新しい遭遇を成立させる。
  // これをしないと、離脱後にエンカウントタイル (30分固定=特定の場所) を踏むたび createGuard が InvalidSwap
  // → 500「移動できなかった」で詰まる。孤立ガードの戦闘は未報酬なので破棄しても二重報酬にならない。
  // 破棄は削除 + 作成の 2 往復ではなく、読んだ CID を期待する 1 回の置き換え (CAS) で行う。
  const guard: Guard = {
    did: userDid, battleId, turn: 0, sealed: { archetype, tier, tile: tileKey(mapId, x, y), ...(mapId !== WORLD_MAP_ID ? { mapId } : {}), baseStats: [...baseStats],
      ...(story ? { story: { battleId: story.id, winFlag: story.winFlag, ...(story.loseFlag ? { loseFlag: story.loseFlag } : {}) } } : {}),
      ...(party.length ? { party } : {}), ...(manualOf(state, party).length ? { manual: manualOf(state, party) } : {}) }, state: battle, pendingTurnSeed, rewarded,
    expiresAt: new Date((now + GUARD_TTL_SEC) * 1000).toISOString(), createdAt: nowIso, updatedAt: nowIso,
  };
  // 読んだ後に別の遭遇がガードを作った/置き換えたら InvalidSwap → 上位で 409 (二重戦闘を作らせない)。
  if (existing) await advanceGuard(env, now, guard, existing.cid);
  else await createGuard(env, now, guard);
  return { battleId, monsterId: battle.monsterId, state: stripState(battle), rewarded };
}

/** 仲間を allies に並べる (倒れた仲間・定義の消えた仲間は出ない)。仲間は自分の Lv で戦う (partyDefsOf。D-PARTY-002 §11)。
 *  戦闘に出た仲間の id を返す。 */
function joinParty(battle: BattleState, state: GameState, jobLevel: number): string[] {
  const members = partyMembers(partyDefsOf(state.party, recruitById, jobLevel), jobLevel, partyCarryOf(state.party));
  if (members.length === 0) return [];
  battle.allies = [battle.player, ...members.map((m) => m.combatant)];
  battle.enemies = battle.enemies ?? [battle.monster];
  // さくせん／めいれい は封印の時点の値 (D-PARTY-004)。戦闘中に変えても この戦闘には効かない。
  const modes = members.map((m) => state.party?.mode?.[m.id]);
  if (modes.some(Boolean)) {
    battle.allyModes = [undefined, ...modes];
    battle.partyIds = members.map((m) => m.id);
  }
  return members.map((m) => m.id);
}

/** 封印の時点で めいれい だった、戦闘に出た仲間。 */
const manualOf = (state: GameState, fought: readonly string[]) => fought.filter((id) => state.party?.mode?.[id] === 'manual');

function partyCarryOf(party: PartyState | undefined): { hp?: Record<string, number>; mp?: Record<string, number> } {
  return { ...(party?.hp ? { hp: party.hp } : {}), ...(party?.mp ? { mp: party.mp } : {}) };
}
