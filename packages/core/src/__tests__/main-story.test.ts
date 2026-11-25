/**
 * 本編の次の目的地 (D-EARLY-002)。本編 = 終わりのフラグ (ending_seen) に至る解禁の鎖にあるクエスト。
 * - ふたばの手紙を終えた新しいプレイヤー → ほむらの街
 * - ending_seen が立っていれば出さない / 本編が無いデータも出さない
 * - 受けられる本編がいくつもあるときは、鎖の浅い順 → データの並び順
 * - 依頼主の街が決まらなければ出さない (throw しない)
 * - isMainQuest (きずなの本編) は広いままで、サイドの依頼は地図の本編に入らない
 * データの形は dev と同じ (内部マップの依頼主・アイテムで次の街の依頼が開く・戦闘のフラグ)。物語の中身は同梱しない。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BASE_PALETTE, STORY_END_FLAG, isMainQuest, mainStorySteps, nextMainQuest, nextStoryTown, npcTown,
  setGameQuests, setInteriors, setNpcs, setScenario, setStory, townAt, worldOverlay,
  type GameQuestDef, type InteriorMap, type StoryProgress,
} from '../index.js';

const FUTABA = { x: 211, y: 340 };
const HOMURA = { x: 320, y: 448 };
const OTAKI = { x: 562, y: 426 };
const FLOOR = BASE_PALETTE.indexOf('plains');
const room = (id: string, extra: Partial<InteriorMap>): InteriorMap => ({ id, name: id, size: 8, tiles: new Uint8Array(64).fill(FLOOR), ...extra });
const quest = (id: string, npcId: string, over: Partial<GameQuestDef> = {}): GameQuestDef => ({
  id, title: id, npcId, intro: ['た'], done: ['あ'], objective: { kind: 'collect', itemId: 'herb', count: 1 }, ...over,
});

function setup(order: 'main-first' | 'side-first' = 'main-first') {
  setInteriors([
    room('futaba-village', { shop: { x: 1, y: 1, town: FUTABA }, exitTo: { mapId: 'world', x: FUTABA.x, y: FUTABA.y + 1 } }),
    room('homura-town', { shop: { x: 1, y: 1, town: HOMURA }, exitTo: { mapId: 'world', x: HOMURA.x, y: HOMURA.y + 1 } }),
    // 店の無い奥の部屋: 出口が街の中へ戻る (ねどこ・塔の上と同じ形)
    room('homura-nest', { exitTo: { mapId: 'homura-town', x: 3, y: 3 } }),
    room('otaki-town', { shop: { x: 1, y: 1, town: OTAKI }, exitTo: { mapId: 'world', x: OTAKI.x + 1, y: OTAKI.y } }),
    room('lost-room', {}),
  ], [{ from: { mapId: 'world', x: HOMURA.x, y: HOMURA.y }, to: { mapId: 'homura-town', x: 4, y: 7 } }]);
  setNpcs([
    { id: 'elder', name: 'むらおさ', mapId: 'futaba-village', x: 2, y: 2, lines: ['や'] },
    { id: 'guide', name: 'あんない', mapId: 'futaba-village', x: 3, y: 2, lines: ['や'] },
    { id: 'homura-elder', name: 'まちおさ', mapId: 'homura-town', x: 2, y: 2, lines: ['や'], altLines: [{ flags: ['homura_slimes_done'], lines: ['くる'], battle: 'b-x' }] },
    { id: 'bird', name: 'とり', mapId: 'homura-nest', x: 2, y: 2, lines: ['や'] },
    { id: 'innkeeper', name: 'やどや', mapId: 'homura-town', x: 3, y: 2, lines: ['や'] },
    { id: 'otaki-host', name: 'あるじ', mapId: 'otaki-town', x: 2, y: 2, lines: ['や'] },
    { id: 'lost', name: 'まいご', mapId: 'lost-room', x: 2, y: 2, lines: ['や'] },
  ]);
  const main = [
    quest('futaba-slimes', 'elder'),
    quest('futaba-letter', 'guide', { requireFlags: ['futaba_slimes_done'], reward: { itemId: 'stone-water', count: 1 } }),
    // 次の街の依頼は「手紙を持っていたら」開く (フラグでなくアイテム)
    quest('homura-slimes', 'homura-elder', { requireItems: [{ itemId: 'stone-water' }] }),
    quest('homura-ember', 'bird', { requireFlags: ['homura_awake'] }),
    quest('tanima-hands', 'otaki-host', { requireFlags: ['homura_feather_done'] }),
  ];
  // サイド: 手紙のあとに開くが、終わりには要らない (シナリオの questDone には出る = きずなでは本編)
  const side = [quest('homura-traveler', 'innkeeper', { requireFlags: ['futaba_letter_done'] })];
  setGameQuests(order === 'main-first' ? [...main, ...side] : [...side, ...main]);
  setScenario([
    { id: 'e1', title: '1', when: [{ kind: 'questDone', questId: 'futaba-slimes' }], setFlags: ['futaba_slimes_done'] },
    { id: 'e2', title: '2', when: [{ kind: 'questDone', questId: 'futaba-letter' }], setFlags: ['futaba_letter_done'] },
    { id: 'e3', title: '3', when: [{ kind: 'questDone', questId: 'homura-slimes' }], setFlags: ['homura_slimes_done'] },
    { id: 'e4', title: '4', when: [{ kind: 'flag', flag: 'homura_x_lost' }], setFlags: ['homura_awake'] },
    { id: 'e5', title: '5', when: [{ kind: 'questDone', questId: 'homura-ember' }], setFlags: ['homura_feather_done'] },
    { id: 'e6', title: '6', when: [{ kind: 'questDone', questId: 'tanima-hands' }], setFlags: [STORY_END_FLAG] },
    { id: 'e7', title: '7', when: [{ kind: 'questDone', questId: 'homura-traveler' }], setFlags: ['homura_traveler_done'] },
  ]);
  // 台本負けの戦闘が、ねどこの依頼を開くフラグを立てる (NPC のセリフの戦闘)
  setStory({ placedItems: [], battles: [{ id: 'b-x', monsterId: 'sky-slime', count: 1, winFlag: 'homura_x_won', loseFlag: 'homura_x_lost' }] });
}

const fresh = (over: Partial<StoryProgress> = {}): StoryProgress => ({ flags: [], questsDone: [], activeQuests: [], materials: {}, ...over });
/** ふたばの手紙まで終えた新しいプレイヤー (報酬の手紙を持っている)。 */
const afterFutaba = fresh({
  flags: ['futaba_slimes_done', 'futaba_letter_done'], questsDone: ['futaba-slimes', 'futaba-letter'], materials: { 'stone-water': 1 },
});

describe('本編の次の目的地 (D-EARLY-002)', () => {
  afterEach(() => { setStory(null); setScenario(null); setGameQuests(null); setNpcs(null); setInteriors(null, null); });

  it('本編 = 終わりのフラグに至る鎖のクエストだけ。鎖の浅い順', () => {
    setup();
    expect(mainStorySteps().map((s) => [s.quest.id, s.depth])).toEqual([
      ['futaba-slimes', 0], ['futaba-letter', 1], ['homura-slimes', 2], ['homura-ember', 3], ['tanima-hands', 4],
    ]);
    // きずなの本編 (isMainQuest) は広いまま: サイドもシナリオの questDone に出るので入る。意味は変えない
    expect(isMainQuest('homura-traveler')).toBe(true);
  });

  it('新しいプレイヤーは ふたばの村。ふたばの手紙を終えると ほむらの街', () => {
    setup();
    expect(nextStoryTown(fresh())?.name).toBe('ふたばの村');
    expect(nextMainQuest(afterFutaba)?.id).toBe('homura-slimes');
    expect(nextStoryTown(afterFutaba)).toEqual(townAt(HOMURA.x, HOMURA.y));
    expect(nextStoryTown(afterFutaba)?.name).toBe('ほむらの街');
  });

  it('受注中の本編も目的。奥の部屋の依頼主は、出口をたどって街に着く', () => {
    setup();
    const awake = fresh({ flags: [...afterFutaba.flags, 'homura_slimes_done', 'homura_x_lost', 'homura_awake'], questsDone: [...afterFutaba.questsDone, 'homura-slimes'] });
    expect(nextMainQuest(awake)?.id).toBe('homura-ember');
    expect(nextStoryTown(awake)?.name).toBe('ほむらの街');
    expect(nextMainQuest({ ...afterFutaba, activeQuests: [{ id: 'homura-slimes' }] })?.id).toBe('homura-slimes');
  });

  it('まだ受けられない (戦闘が間にある) ときは、終えていない最も浅い本編の街', () => {
    setup();
    const beforeBattle = fresh({ flags: [...afterFutaba.flags, 'homura_slimes_done'], questsDone: [...afterFutaba.questsDone, 'homura-slimes'] });
    expect(nextMainQuest(beforeBattle)?.id).toBe('homura-ember');
  });

  it('同じ深さで受けられるものが並んだら、データの並び順で決まる', () => {
    // 新しいプレイヤーが受けられる本編は futaba-slimes だけ。サイドを先に並べても本編の選び方は変わらない
    setup('side-first');
    expect(nextMainQuest(fresh())?.id).toBe('futaba-slimes');
    // 同じ深さの本編を 2 つ用意: 終わりに両方要る
    setGameQuests([quest('a-second', 'homura-elder'), quest('a-first', 'elder')]);
    setScenario([{ id: 'end', title: 'e', when: [{ kind: 'questDone', questId: 'a-second' }, { kind: 'questDone', questId: 'a-first' }], setFlags: [STORY_END_FLAG] }]);
    expect(mainStorySteps().map((s) => s.quest.id)).toEqual(['a-second', 'a-first']);
    expect(nextMainQuest(fresh())?.id).toBe('a-second');
    expect(nextMainQuest(fresh({ questsDone: ['a-second'] }))?.id).toBe('a-first');
  });

  it('同じアイテムを本編とサイドの両方が出すとき、本編で手に入れたらサイドは目的にならない', () => {
    setup();
    // つぎの本編 (gate) は品物 3 個で開く。品物は本編の main-a と、サイドの side-s (先に並ぶ・誰でも受けられる) の両方が出す
    setGameQuests([
      quest('side-s', 'innkeeper', { reward: { itemId: 'stone-water', count: 3 } }),
      quest('main-a', 'elder', { reward: { itemId: 'stone-water', count: 3 } }),
      quest('gate', 'otaki-host', { requireItems: [{ itemId: 'stone-water', count: 3 }] }),
    ]);
    setScenario([{ id: 'end', title: 'e', when: [{ kind: 'questDone', questId: 'gate' }], setFlags: [STORY_END_FLAG] }]);
    const afterA = fresh({ questsDone: ['main-a'], materials: { 'stone-water': 3 } });
    expect(nextMainQuest(afterA)?.id).toBe('gate');
    expect(nextStoryTown(afterA)).toEqual(townAt(OTAKI.x, OTAKI.y));
    // 足りなければ、まだ品物を出せる道が目的になる
    expect(nextMainQuest(fresh({ questsDone: ['main-a'], materials: { 'stone-water': 1 } }))?.id).toBe('side-s');
    // 受注中の本編は、品物を使い切っていても目的
    expect(nextMainQuest(fresh({ questsDone: ['main-a'], activeQuests: [{ id: 'gate' }] }))?.id).toBe('gate');
  });

  it('深さ = 要る本編クエストの数。条件なしのイベントのフラグも、誰も出さないアイテムも、要る本編は 0 件', () => {
    setup();
    setGameQuests([
      quest('q-after', 'elder', { requireFlags: ['first_done'] }),
      quest('q-drop', 'elder', { requireItems: [{ itemId: 'herb' }] }),
      quest('q-open', 'elder', { requireFlags: ['opening_seen'] }),
      quest('q-first', 'elder'),
    ]);
    setScenario([
      { id: 'opening', title: 'o', when: [], setFlags: ['opening_seen'] },
      { id: 'first', title: 'f', when: [{ kind: 'questDone', questId: 'q-first' }], setFlags: ['first_done'] },
      { id: 'end', title: 'e', when: ['q-after', 'q-drop', 'q-open'].map((questId) => ({ kind: 'questDone' as const, questId })), setFlags: [STORY_END_FLAG] },
    ]);
    expect(mainStorySteps().map((s) => [s.quest.id, s.depth])).toEqual([
      ['q-drop', 0], ['q-open', 0], ['q-first', 0], ['q-after', 1],
    ]);
  });

  it('ending_seen が立ったら出さない。本編が無いデータも出さない', () => {
    setup();
    expect(nextStoryTown(fresh({ flags: [STORY_END_FLAG] }))).toBeNull();
    expect(nextStoryTown(fresh({ questsDone: ['futaba-slimes', 'futaba-letter', 'homura-slimes', 'homura-ember', 'tanima-hands'] }))).toBeNull();
    setScenario([{ id: 'x', title: 'x', when: [{ kind: 'questDone', questId: 'homura-traveler' }], setFlags: ['homura_traveler_done'] }]);
    expect(mainStorySteps()).toEqual([]);
    expect(nextStoryTown(fresh())).toBeNull();
  });

  it('依頼主の街が決まらなければ出さない (throw しない)', () => {
    setup();
    setGameQuests([quest('lost-q', 'lost')]);
    setScenario([{ id: 'end', title: 'e', when: [{ kind: 'questDone', questId: 'lost-q' }], setFlags: [STORY_END_FLAG] }]);
    expect(nextMainQuest(fresh())?.id).toBe('lost-q');
    expect(npcTown({ mapId: 'lost-room', x: 2, y: 2 })).toBeNull();
    expect(nextStoryTown(fresh())).toBeNull();
    // フィールドに立つ NPC は、そのマスが街のときだけ
    expect(npcTown({ x: FUTABA.x, y: FUTABA.y })?.name).toBe('ふたばの村');
    const spawn = worldOverlay().spawn;
    expect(npcTown({ x: spawn.x + 5, y: spawn.y + 5 })).toBeNull();
  });
});
