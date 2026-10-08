/**
 * **会話の後の戦闘** (D-STORY-009 M4)。NPC のセリフ (altLine.battle) とクエストの受注
 * (startBattle) から、ストーリー戦を封印する。権威は edge: 位置は署名済みトークン
 * (無ければ state の位置)、条件は state.flags で確かめる。client の申告だけでは始まらない。
 */
import { allNpcs, gameQuestById, npcAltLineFor, storyBattleById, storyBattleOpen, type StoryBattleDef } from '@aozoraquest/core';
import { readState, type GameState } from './game-state';
import { enemyWindow, tileEncounter, verifyPosition } from './world-token';
import { besideNpc, GameQuestError, handleQuestAccept, type QuestStateResult } from './game-quest';
import { DEFAULT_NS, migrateInitState, sealEncounter, type EncounterInfo, type ResolverEnv } from './battle-resolver';

/** トークンの位置 (無効なら state の位置) と権威 state。 */
async function positionAndState(env: ResolverEnv, did: string, token: string | undefined, now: number, ns: string): Promise<{ pos: { mapId?: string; x: number; y: number }; state: GameState }> {
  const rec = await readState(env, did);
  const state = rec?.state ?? (await migrateInitState(did, new Date(now * 1000).toISOString(), ns));
  try {
    const claim = verifyPosition(env, token ?? '', did, now);
    return { pos: claim, state };
  } catch {
    return { pos: { ...(state.mapId ? { mapId: state.mapId } : {}), x: state.x, y: state.y }, state };
  }
}

function seal(env: ResolverEnv, did: string, state: GameState, pos: { mapId?: string; x: number; y: number }, battle: StoryBattleDef, now: number, ns: string): Promise<EncounterInfo> {
  const { monsterSeed } = tileEncounter(env, pos.x, pos.y, enemyWindow(now));
  return sealEncounter(env, did, state, pos.x, pos.y, monsterSeed, now, ns, undefined, pos.mapId, battle);
}

/** `POST /api/story/battle`: 隣の NPC の、いま選ばれるセリフに付いた戦闘を始める。 */
export async function handleStoryBattle(env: ResolverEnv, did: string, npcId: string, token: string | undefined, now: number, ns: string = DEFAULT_NS): Promise<EncounterInfo> {
  const npc = allNpcs().find((n) => n.id === npcId);
  if (!npc) throw new GameQuestError('はなす あいてが いない', 404, 'unknown_npc');
  const { pos, state } = await positionAndState(env, did, token, now, ns);
  if (!besideNpc(npc, pos)) throw new GameQuestError('はなす あいてが ちかくに いない', 400, 'not_ready');
  const flags = state.flags ?? [];
  const id = npcAltLineFor(npc, flags, state.materials)?.battle;
  const battle = id ? storyBattleById(id) : undefined;
  if (!battle || !storyBattleOpen(battle, undefined, flags)) throw new GameQuestError('いまは たたかう ときではない', 400, 'not_ready');
  return seal(env, did, state, pos, battle, now, ns);
}

/**
 * クエストの受注。startBattle があれば、依頼主の隣にいることを先に確かめ、**今回新しく受けた**
 * かつ winFlag が未設定のときだけ戦闘を封印する (受注済みの再送で何度も戦えない)。
 */
export async function handleQuestAcceptWithBattle(
  env: ResolverEnv, did: string, questId: string, token: string | undefined, now: number, ns: string = DEFAULT_NS,
): Promise<QuestStateResult & { encounter?: EncounterInfo }> {
  const init = (d: string, iso: string) => migrateInitState(d, iso, ns);
  const def = gameQuestById(questId);
  const battle = def?.startBattle ? storyBattleById(def.startBattle) : undefined;
  if (!def || !battle) {
    const { newlyAccepted: _n, ...res } = await handleQuestAccept(env, did, questId, now, init);
    return res;
  }
  const { pos, state } = await positionAndState(env, did, token, now, ns);
  const giver = allNpcs().find((n) => n.id === def.npcId);
  if (!giver || !besideNpc(giver, pos)) throw new GameQuestError('はなす あいてが ちかくに いない', 400, 'not_ready');
  const { newlyAccepted, ...res } = await handleQuestAccept(env, did, questId, now, init);
  if (!newlyAccepted || (res.flags ?? []).includes(battle.winFlag)) return res;
  return { ...res, encounter: await seal(env, did, state, pos, battle, now, ns) };
}
