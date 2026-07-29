/**
 * ゲーム内クエスト定義 (#423) の検証。**壊れた 1 件で全体を落とす** (他エディタと同じ流儀)。
 * 参照先 (NPC/モンスター/アイテム) の実在検証が要 — 未知 id を通すと
 * 「受けられるのに絶対に達成できないクエスト」が静かに生まれる。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setGameQuests, gameQuests, gameQuestById, gameQuestByNpc, QuestDataError, MAX_QUEST_REWARD_POWER, type GameQuestDef } from '../quest-data.js';
import { setNpcs } from '../npc-data.js';
import { MONSTERS, ITEMS } from '../battle.js';

const MON = MONSTERS[0]!.id;
const ITEM = Object.keys(ITEMS)[0]!;

const base = (over: Partial<GameQuestDef> = {}): GameQuestDef => ({
  id: 'q1', title: 'たいじ', npcId: 'n1',
  intro: ['たのむ'], done: ['ありがとう'],
  objective: { kind: 'defeat', monsterId: MON, count: 3 },
  ...over,
});

beforeEach(() => {
  setNpcs([
    { id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'] },
    { id: 'n2', name: 'むらびと', x: 2, y: 1, lines: ['やあ'] },
  ]);
});
afterEach(() => {
  setGameQuests(null);
  setNpcs(null);
});

describe('setGameQuests の検証', () => {
  it('正常な定義を受け付け、id / NPC で引ける', () => {
    setGameQuests([base()]);
    expect(gameQuests()).toHaveLength(1);
    expect(gameQuestById('q1')?.title).toBe('たいじ');
    expect(gameQuestByNpc('n1')?.id).toBe('q1');
    expect(gameQuestByNpc('n2')).toBeUndefined();
  });

  it('null で全解除', () => {
    setGameQuests([base()]);
    setGameQuests(null);
    expect(gameQuests()).toHaveLength(0);
    expect(gameQuestByNpc('n1')).toBeUndefined();
  });

  it('存在しない NPC を弾く', () => {
    expect(() => setGameQuests([base({ npcId: 'ghost' })])).toThrow(QuestDataError);
  });

  it('存在しないモンスターを弾く', () => {
    expect(() => setGameQuests([base({ objective: { kind: 'defeat', monsterId: 'ghost', count: 1 } })])).toThrow(QuestDataError);
  });

  it('存在しないアイテム (collect / 報酬とも) を弾く', () => {
    expect(() => setGameQuests([base({ objective: { kind: 'collect', itemId: 'ghost', count: 1 } })])).toThrow(QuestDataError);
    expect(() => setGameQuests([base({ reward: { itemId: 'ghost', count: 1 } })])).toThrow(QuestDataError);
  });

  it('1 NPC 1 クエスト (重複した発注を弾く)', () => {
    expect(() => setGameQuests([base(), base({ id: 'q2' })])).toThrow(QuestDataError);
  });

  it('id 重複を弾く', () => {
    expect(() => setGameQuests([base(), base({ npcId: 'n2' })])).toThrow(QuestDataError);
  });

  it('個数は 1〜99 の整数', () => {
    for (const count of [0, -1, 1.5, 100]) {
      expect(() => setGameQuests([base({ objective: { kind: 'defeat', monsterId: MON, count } })])).toThrow(QuestDataError);
    }
  });

  it('報酬パワーの上限を超える定義を弾く (経済の暴走防止)', () => {
    expect(() => setGameQuests([base({ reward: { power: MAX_QUEST_REWARD_POWER + 1 } })])).toThrow(QuestDataError);
    setGameQuests([base({ reward: { power: MAX_QUEST_REWARD_POWER } })]); // 上限ちょうどは OK
  });

  it('報酬アイテムには個数が必須', () => {
    expect(() => setGameQuests([base({ reward: { itemId: ITEM } })])).toThrow(QuestDataError);
  });

  it('セリフの空配列・空文字を弾く', () => {
    expect(() => setGameQuests([base({ intro: [] })])).toThrow(QuestDataError);
    expect(() => setGameQuests([base({ done: ['  '] })])).toThrow(QuestDataError);
  });

  it('壊れた 1 件で全体を落とす (部分適用しない)', () => {
    setGameQuests([base()]);
    expect(() => setGameQuests([base({ id: 'ok', npcId: 'n2' }), base({ id: 'bad', npcId: 'ghost' })])).toThrow(QuestDataError);
    // 落ちた後も前の状態のまま (ok だけが入る、はしない)
    expect(gameQuestById('ok')).toBeUndefined();
    expect(gameQuestById('q1')).toBeDefined();
  });
});
