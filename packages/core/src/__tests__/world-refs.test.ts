/**
 * ワールド定義どうしの逆参照 (#603)。守るべき不変条件:
 * - **参照されている id は「切れる参照」として全部挙がる** (参照の種類ごとに 1 件も抜けない)
 * - 残す id への参照は挙がらない (消していないのに保存を拒否しない)
 * - 参照元の説明はエディタにそのまま出せる
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { danglingRefs, describeDanglingRef, worldRefs } from '../world-refs.js';
import { setGameQuests } from '../quest-data.js';
import { setNpcs } from '../npc-data.js';
import { setShopOverrides } from '../shop-data.js';
import { setInteriors, WORLD_MAP_ID } from '../interior.js';
import { setScenario } from '../scenario.js';
import { MONSTERS, ITEMS } from '../battle.js';
import { EQUIPMENT } from '../equipment.js';
import { activeEquipment, activeItems, setItemOverrides } from '../item-data.js';

const MON = MONSTERS[0]!.id;
const MON2 = MONSTERS[1]!.id;
/** テスト専用の品 (誰もドロップしない = 参照元がこのテストの定義だけになる)。 */
const TEST_ITEMS = ['t-item-1', 't-item-2', 't-item-3', 't-item-4', 't-item-5', 't-item-6'] as const;
const [ITEM, ITEM2, ITEM3, ITEM4, ITEM5, ITEM6] = TEST_ITEMS;
const DROPPER = MONSTERS.find((m) => m.drops.length > 0)!;
const DROP_ITEM = DROPPER.drops[0]!.item;
const EQ = EQUIPMENT[0]!.id;
const EQ2 = EQUIPMENT[1]!.id;

beforeEach(() => {
  setItemOverrides({ items: [...activeItems(), ...TEST_ITEMS.map((id) => ({ id, name: id }))], equipment: [...activeEquipment()] });
  setNpcs([
    { id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'] },
    { id: 'n2', name: 'むらびと', x: 2, y: 1, lines: ['やあ'], altLines: [{ items: [{ itemId: ITEM4 }], lines: ['それを持っているのか'] }] },
  ]);
  setGameQuests([
    { id: 'q1', title: 'たいじ', npcId: 'n1', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'defeat', monsterId: MON, count: 3 } },
    {
      id: 'q2', title: 'あつめ', npcId: 'n2', intro: ['たのむ'], done: ['ありがとう'],
      objective: { kind: 'collect', itemId: ITEM, count: 2 },
      reward: { itemId: ITEM2, count: 1 },
      requireItems: [{ itemId: ITEM3 }],
    },
  ]);
  setShopOverrides([{ x: 10, y: 10, equipment: [EQ], consumables: [ITEM5], materialId: ITEM6 }]);
  setInteriors([], [{ from: { mapId: WORLD_MAP_ID, x: 1, y: 1 }, to: { mapId: WORLD_MAP_ID, x: 2, y: 2 }, requireItems: [{ itemId: ITEM3, count: 2 }] }]);
  setScenario([{ id: 'e1', title: 'はじまり', when: [{ kind: 'questDone', questId: 'q1' }, { kind: 'itemCount', itemId: ITEM4, count: 1 }], setFlags: ['started'] }]);
});
afterEach(() => {
  setScenario(null);
  setInteriors(null, null);
  setShopOverrides(null);
  setGameQuests(null);
  setNpcs(null);
  setItemOverrides(null);
});

const froms = (kind: Parameters<typeof worldRefs>[0], id: string) => worldRefs(kind).filter((r) => r.id === id).map((r) => r.from);

describe('worldRefs: 参照の種類ごとに全部挙がる', () => {
  it('NPC ← クエストの発注者', () => {
    expect(froms('npc', 'n1')).toEqual(['クエスト「たいじ」']);
    expect(froms('npc', 'n2')).toEqual(['クエスト「あつめ」']);
  });

  it('モンスター ← クエストの討伐条件', () => {
    expect(froms('monster', MON)).toEqual(['クエスト「たいじ」']);
    expect(froms('monster', MON2)).toEqual([]);
  });

  it('アイテム ← クエスト (収集/報酬/解禁)・店 (どうぐ/素材)・ゲート・NPC のセリフ・シナリオ', () => {
    expect(froms('item', ITEM)).toEqual(['クエスト「あつめ」']);
    expect(froms('item', ITEM2)).toEqual(['クエスト「あつめ」']);
    expect(froms('item', ITEM3)).toEqual(['クエスト「あつめ」', `ゲート (${WORLD_MAP_ID} 1,1)`]);
    expect(froms('item', ITEM4)).toEqual(['NPC「むらびと」のセリフ', 'シナリオ「はじまり」']);
    expect(froms('item', ITEM5)).toEqual(['店 (10, 10)']);
    expect(froms('item', ITEM6)).toEqual(['店 (10, 10)']);
  });

  it('アイテム ← モンスターのドロップ', () => {
    expect(froms('item', DROP_ITEM)).toContain(`モンスター「${DROPPER.name}」のドロップ`);
  });

  it('装備 ← 店のラインナップ', () => {
    expect(froms('equipment', EQ)).toEqual(['店 (10, 10)']);
    expect(froms('equipment', EQ2)).toEqual([]);
  });

  it('クエスト ← シナリオの達成条件', () => {
    expect(froms('quest', 'q1')).toEqual(['シナリオ「はじまり」']);
    expect(froms('quest', 'q2')).toEqual([]);
  });
});

describe('danglingRefs: 残す id への参照は挙がらない', () => {
  it('全部残せば空', () => {
    expect(danglingRefs('monster', MONSTERS.map((m) => m.id))).toEqual([]);
    expect(danglingRefs('item', Object.keys(ITEMS))).toEqual([]);
    expect(danglingRefs('equipment', EQUIPMENT.map((e) => e.id))).toEqual([]);
    expect(danglingRefs('npc', ['n1', 'n2'])).toEqual([]);
    expect(danglingRefs('quest', ['q1', 'q2'])).toEqual([]);
  });

  it('参照されているモンスターを消すと、そのクエストが挙がる', () => {
    const refs = danglingRefs('monster', MONSTERS.filter((m) => m.id !== MON).map((m) => m.id));
    expect(refs).toEqual([{ kind: 'monster', id: MON, from: 'クエスト「たいじ」' }]);
    expect(describeDanglingRef(refs[0]!)).toBe(`保存できない: クエスト「たいじ」がモンスター「${MON}」を参照している。先にそちらを直す`);
  });

  it('参照されていないモンスターを消しても空', () => {
    expect(danglingRefs('monster', MONSTERS.filter((m) => m.id !== MON2).map((m) => m.id))).toEqual([]);
  });

  it('参照されているアイテムを消すと、参照元が全部挙がる (店のラインナップ含む)', () => {
    const keep = Object.keys(ITEMS).filter((id) => id !== ITEM3 && id !== ITEM5);
    expect(danglingRefs('item', keep).map((r) => [r.id, r.from])).toEqual([
      [ITEM3, 'クエスト「あつめ」'],
      [ITEM5, '店 (10, 10)'],
      [ITEM3, `ゲート (${WORLD_MAP_ID} 1,1)`],
    ]);
  });

  it('ドロップ先のアイテムを消すと、そのモンスターが挙がる', () => {
    const refs = danglingRefs('item', Object.keys(ITEMS).filter((id) => id !== DROP_ITEM));
    expect(refs.map((r) => r.from)).toContain(`モンスター「${DROPPER.name}」のドロップ`);
    expect(refs.every((r) => r.id === DROP_ITEM)).toBe(true);
  });

  it('参照されている装備を消すと、その店が挙がる', () => {
    expect(danglingRefs('equipment', EQUIPMENT.filter((e) => e.id !== EQ).map((e) => e.id))).toEqual([
      { kind: 'equipment', id: EQ, from: '店 (10, 10)' },
    ]);
  });
});
