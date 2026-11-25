/**
 * **本編の次の目的地** (D-EARLY-002)。せかいちずで、次に行く街を点滅させるために使う。
 *
 * 本編はデータに印が無いので、**終わりのフラグ `STORY_END_FLAG` に至る解禁の鎖**から決める。
 * 鎖をたどるのは、ストーリーを動かす条件と、それを満たすもの:
 * - シナリオのイベント: when (questDone / flag / itemCount) → setFlags
 * - クエストの受注条件: requireFlags / requireItems → そのクエストの達成。報酬のアイテム ← 達成
 * - ストーリー戦: 受注で始まる戦闘・NPC のセリフの戦闘 (flags / items)・固定モンスター (requireFlags) → winFlag / loseFlag
 * - 置きアイテム: requireFlags → flag / 中身のアイテム
 * その鎖にあるクエストが本編。dev のデータでは ふたば → ほむら → … → おおたき の 27 件の一本道になる。
 *
 * `isMainQuest` (bond.ts。きずなの本編 +10) は「シナリオの questDone 条件に出てくるクエスト」で、
 * サイドの依頼も多く入る。こちらは地図の案内だけに使う別の基準で、isMainQuest の意味は変えない。
 * (bond.ts に置くと bond → story-data → battle → bond の循環 import になるので別ファイル。)
 */
import { gameQuests, type GameQuestDef } from './quest-data.js';
import { scenarioEvents, itemsSatisfied } from './scenario.js';
import { fieldMonsters, placedItems, placedRewards, storyBattleById } from './story-data.js';
import { allNpcs, type NpcDef } from './npc-data.js';
import { allGates, interiorById } from './interior.js';
import { townAt, type Town } from './world.js';
import { WORLD_MAP_ID } from './map-id.js';

/** 本編の終わり (エンディングを見た) のフラグ。立ったら案内しない。 */
export const STORY_END_FLAG = 'ending_seen';

/** 案内に使う進み具合 (edge の GameState の写し)。 */
export interface StoryProgress {
  flags: readonly string[];
  questsDone: readonly string[];
  activeQuests: readonly { id: string }[];
  materials: Readonly<Record<string, number>>;
}

/** 本編のクエスト 1 件と、鎖の深さ (それより前に要る本編クエストの数の最小)。 */
export interface MainStoryStep {
  quest: GameQuestDef;
  depth: number;
}

type Fact = string; // 'f:<flag>' | 'q:<questId>' (達成) | 'i:<itemId>'
const flagFact = (f: string): Fact => `f:${f}`;
const questFact = (id: string): Fact => `q:${id}`;
const itemFact = (id: string): Fact => `i:${id}`;

/** 事実 → それを満たす手段 (手段ごとに、要る事実の並び)。 */
function producers(): Map<Fact, Fact[][]> {
  const out = new Map<Fact, Fact[][]>();
  const add = (fact: Fact, needs: Fact[]) => out.set(fact, [...(out.get(fact) ?? []), needs]);
  const reqs = (flags: readonly string[] | undefined, items: readonly { itemId: string }[] | undefined) => [
    ...(flags ?? []).map(flagFact), ...(items ?? []).map((r) => itemFact(r.itemId)),
  ];
  const battleFlags = (battleId: string, needs: Fact[]) => {
    const b = storyBattleById(battleId);
    if (!b) return;
    add(flagFact(b.winFlag), needs);
    if (b.loseFlag) add(flagFact(b.loseFlag), needs);
  };
  for (const e of scenarioEvents()) {
    const needs = e.when.flatMap((c): Fact[] => (c.kind === 'questDone' ? [questFact(c.questId)] : c.kind === 'flag' ? [flagFact(c.flag)] : c.kind === 'itemCount' ? [itemFact(c.itemId)] : []));
    for (const f of e.setFlags) add(flagFact(f), needs);
  }
  for (const q of gameQuests()) {
    add(questFact(q.id), reqs(q.requireFlags, q.requireItems));
    if (q.reward?.itemId) add(itemFact(q.reward.itemId), [questFact(q.id)]);
    if (q.startBattle) battleFlags(q.startBattle, [questFact(q.id)]);
  }
  for (const n of allNpcs()) for (const a of n.altLines ?? []) if (a.battle) battleFlags(a.battle, reqs(a.flags, a.items));
  for (const m of fieldMonsters()) battleFlags(m.battleId, reqs(m.requireFlags, undefined));
  for (const p of placedItems()) {
    const needs = reqs(p.requireFlags, undefined);
    if (p.flag) add(flagFact(p.flag), needs);
    for (const r of placedRewards(p)) if ('item' in r) add(itemFact(r.item), needs);
  }
  return out;
}

/** 本編のクエストを、鎖の深さが浅い順 (同じならデータの並び順) に。本編が無いデータなら空。 */
export function mainStorySteps(): MainStoryStep[] {
  const by = producers();
  // 終わりのフラグから逆にたどる (どの手段も候補なので、すべての手段の要るものを集める)。
  const needed = new Set<Fact>();
  const stack: Fact[] = [flagFact(STORY_END_FLAG)];
  while (stack.length) {
    for (const needs of by.get(stack.pop()!) ?? []) {
      for (const f of needs) if (!needed.has(f)) { needed.add(f); stack.push(f); }
    }
  }
  // 深さ: その事実を満たすのに要る本編クエストの数の最小 (手段の中で最小、要るものの中で最大)。
  // 満たす手段が無い事実 (はじめから持っている物・データの外で立つフラグ) は 0。輪になって決まらないものは除く。
  const depth = new Map<Fact, number>();
  const facts = [...needed];
  for (const f of facts) if (!by.has(f)) depth.set(f, 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const f of facts) {
      let best = depth.get(f) ?? Infinity;
      for (const needs of by.get(f) ?? []) {
        const d = needs.reduce((m, n) => Math.max(m, depth.get(n) ?? Infinity), -1) + (f.startsWith('q:') ? 1 : 0);
        if (d < best) best = d;
      }
      if (best < (depth.get(f) ?? Infinity)) { depth.set(f, best); changed = true; }
    }
  }
  return gameQuests()
    .map((quest, order) => ({ quest, order, depth: depth.get(questFact(quest.id)) }))
    .filter((s): s is { quest: GameQuestDef; order: number; depth: number } => needed.has(questFact(s.quest.id)) && s.depth !== undefined && Number.isFinite(s.depth))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map(({ quest, depth: d }) => ({ quest, depth: d }));
}

/**
 * いまの本編の目的のクエスト。まだ終えていない本編のうち、受けられる (受注中を含む) ものを先に、
 * その中で鎖の浅い順・データの並び順。受けられるものが無ければ、まだ終えていない最も浅いもの
 * (戦闘やしらべるが間にあるとき)。終わりのフラグが立っている・本編が無いなら undefined。
 */
export function nextMainQuest(p: StoryProgress): GameQuestDef | undefined {
  if (p.flags.includes(STORY_END_FLAG)) return undefined;
  const open = (q: GameQuestDef) => p.activeQuests.some((a) => a.id === q.id)
    || ((q.requireFlags ?? []).every((f) => p.flags.includes(f)) && itemsSatisfied(q.requireItems, p.materials));
  const left = mainStorySteps().filter((s) => !p.questsDone.includes(s.quest.id));
  return (left.find((s) => open(s.quest)) ?? left[0])?.quest;
}

/**
 * NPC のいるフィールドの街。内部マップは なんでも屋の街 → フィールドからの入口のゲート → 出口の先のマップ、の順にたどる。
 * フィールドに立つ NPC はそのマスが街のときだけ。決まらなければ null。
 */
export function npcTown(npc: Pick<NpcDef, 'mapId' | 'x' | 'y'>): Town | null {
  let mapId = npc.mapId ?? WORLD_MAP_ID;
  if (mapId === WORLD_MAP_ID) return townAt(npc.x, npc.y);
  const seen = new Set<string>();
  while (!seen.has(mapId)) {
    seen.add(mapId);
    const map = interiorById(mapId);
    if (!map) return null;
    const shopTown = map.shop ? townAt(map.shop.town.x, map.shop.town.y) : null;
    if (shopTown) return shopTown;
    const entry = allGates().find((g) => g.to.mapId === mapId && g.from.mapId === WORLD_MAP_ID);
    const gateTown = entry ? townAt(entry.from.x, entry.from.y) : null;
    if (gateTown) return gateTown;
    if (!map.exitTo) return null;
    if (map.exitTo.mapId === WORLD_MAP_ID) return townAt(map.exitTo.x, map.exitTo.y);
    mapId = map.exitTo.mapId;
  }
  return null;
}

/** 本編の次の目的地の街 (目的のクエストの依頼主の街)。決まらなければ null (案内しない)。 */
export function nextStoryTown(p: StoryProgress): Town | null {
  const q = nextMainQuest(p);
  const npc = q ? allNpcs().find((n) => n.id === q.npcId) : undefined;
  return npc ? npcTown(npc) : null;
}
