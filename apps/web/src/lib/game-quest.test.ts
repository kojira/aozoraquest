import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONSTERS, setGameQuests, setNpcs, type GameQuestDef } from '@aozoraquest/core';
import {
  activeQuest,
  questAcceptChoices,
  questAfterBattle,
  questBusyLines,
  questMenuLine,
  questOfferLines,
  questStateOf,
  QUEST_ASK,
} from './game-quest';

const MON = MONSTERS[0]!;
const Q1: GameQuestDef = { id: 'q1', title: 'スライム たいじ', npcId: 'n1', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'defeat', monsterId: MON.id, count: 3 } };
const Q2: GameQuestDef = { id: 'q2', title: 'くすり あつめ', npcId: 'n2', intro: ['やくそうを'], done: ['たすかった'], objective: { kind: 'collect', itemId: 'herb', count: 2 } };

beforeEach(() => {
  setNpcs([
    { id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'] },
    { id: 'n2', name: 'むらびと', x: 2, y: 1, lines: ['やあ'] },
  ]);
  setGameQuests([Q1, Q2]);
});
afterEach(() => {
  setGameQuests(null);
  setNpcs(null);
});

describe('サーバー応答からの写し', () => {
  it('questStateOf: quest / questsDone を写す (無ければ空)', () => {
    expect(questStateOf({})).toEqual({ done: [] });
    expect(questStateOf({ quest: { id: 'q1', progress: 2 }, questsDone: ['q0'] })).toEqual({ active: { id: 'q1', progress: 2 }, done: ['q0'] });
  });

  it('questAfterBattle: 応答に quest があれば進捗を差し替え、無ければそのまま', () => {
    const st = { active: { id: 'q1', progress: 1 }, done: ['q0'] };
    expect(questAfterBattle(st, { id: 'q1', progress: 2 })).toEqual({ active: { id: 'q1', progress: 2 }, done: ['q0'] });
    expect(questAfterBattle(st, undefined)).toBe(st);
  });

  it('activeQuest: 定義が消えた受注中クエストは無かったことにする', () => {
    expect(activeQuest({ active: { id: 'q1', progress: 1 }, done: [] })?.def.id).toBe('q1');
    expect(activeQuest({ active: { id: 'gone', progress: 1 }, done: [] })).toBeUndefined();
    expect(activeQuest({ done: [] })).toBeUndefined();
  });
});

describe('メニューの 1 行', () => {
  it('受注中なら core の進捗文、受注中でなければ undefined (行を出さない)', () => {
    expect(questMenuLine({ active: { id: 'q1', progress: 2 }, done: [] }, {})).toBe(`スライム たいじ: ${MON.name}を 3 たい (2/3)`);
    expect(questMenuLine({ done: [] }, {})).toBeUndefined();
  });

  it('collect は所持数が進捗', () => {
    expect(questMenuLine({ active: { id: 'q2', progress: 0 }, done: [] }, { herb: 1 })).toBe('くすり あつめ: やくそうを 2 こ (1/2)');
  });
});

describe('依頼のセリフ', () => {
  it('未受注: intro のあとに「うけますか？」', () => {
    expect(questOfferLines(Q1)).toEqual(['たのむ', QUEST_ASK]);
  });

  it('別のクエストを受注中: 受注中の題名を出し、確認は出さない', () => {
    expect(questBusyLines(Q1, Q2)).toEqual(['たのむ', 'いまは 『くすり あつめ』を うけおっている。']);
    expect(questBusyLines(Q1, Q2)).not.toContain(QUEST_ASK);
  });

  it('questAcceptChoices: はい は questId 付きで onYes、いいえ は何もしない。questId 無しなら選択肢なし', () => {
    const onYes = vi.fn();
    const choices = questAcceptChoices('q1', onYes)!;
    expect(choices.map((c) => c.label)).toEqual(['はい', 'いいえ']);
    choices[1]!.onSelect();
    expect(onYes).not.toHaveBeenCalled();
    choices[0]!.onSelect();
    expect(onYes).toHaveBeenCalledWith('q1');
    expect(questAcceptChoices(undefined, onYes)).toBeUndefined();
  });
});
