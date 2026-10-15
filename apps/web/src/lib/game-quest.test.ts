import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONSTERS, setGameQuests, setInteriors, setNpcs, type GameQuestDef } from '@aozoraquest/core';
import {
  guildQuestDetailLines,
  questAcceptChoices,
  questAfterBattle,
  questLogEntries,
  questTermsLine,
  questChoiceTitle,
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
  setInteriors([{ id: 'village', name: 'ふたばの村', size: 4, tiles: new Uint8Array(16) }], []);
});
afterEach(() => {
  setInteriors(null, null);
  setGameQuests(null);
  setNpcs(null);
});

describe('multi-active server mirror and shared materials', () => {
  const activeQuests = [{ id: 'q1', progress: 2 }, { id: 'q2', progress: 0 }];
  it('replaces full snapshots, distinguishes empty from missing turn snapshots', () => {
    const st = questStateOf({ activeQuests, questsDone: ['q0'] });
    expect(st).toEqual({ activeQuests, done: ['q0'] });
    expect(questAfterBattle(st, undefined)).toBe(st);
    expect(questAfterBattle(st, [], ['q0', 'q1'])).toEqual({ activeQuests: [], done: ['q0', 'q1'] });
    expect(questStateOf({})).toEqual({ activeQuests: [], done: [] });
  });
  it('quest log entries: guild/personal sections, giver with place, shared inventory, unknown IDs', () => {
    setNpcs([
      { id: 'n1', name: 'そんちょう', x: 1, y: 1, lines: ['やあ'], mapId: 'village' },
      { id: 'n2', name: 'うけつけ', x: 2, y: 1, lines: ['やあ'], mapId: 'village', guildReception: true },
    ]);
    setGameQuests([Q1, Q2, { ...Q2, id: 'q3' }]);
    const st = { activeQuests: [...activeQuests, { id: 'q3', progress: 0 }, { id: 'gone', progress: 9 }], done: ['q0'] };
    const e = questLogEntries(st, { herb: 2 });
    expect(e.map(x => [x.id, x.section, x.ready])).toEqual([['q1', 'personal', false], ['q2', 'guild', true], ['q3', 'guild', true], ['gone', 'personal', false]]);
    expect(e[0]).toMatchObject({ title: 'スライム たいじ', giver: '依頼: そんちょう（ふたばの村）', progress: expect.stringContaining('(2/3)'), detail: questTermsLine(Q1) });
    expect(e[1]).toMatchObject({ giver: '依頼: うけつけ（ふたばの村 ギルド）', progress: 'やくそうを 2 こ (2/2)' });
    expect(questLogEntries(st, {})[1]!.ready).toBe(false);
    expect(e[3]).toEqual({ id: 'gone', section: 'personal', title: '依頼情報を確認できません（gone）', ready: false });
  });
  it('disambiguates identical titles and objectives by ID for both choice entry points', () => {
    const other = { ...Q2, id: 'q3' };
    expect(questChoiceTitle(Q2, [Q2, other])).toContain('（q2）');
    expect(questChoiceTitle(other, [Q2, other])).toContain('（q3）');
    expect(questChoiceTitle(Q1, [Q1, Q2])).toBe(Q1.title);
  });
});

describe('依頼のセリフ', () => {
  it('未受注: intro のあとに「うけますか？」', () => {
    expect(questOfferLines(Q1)).toEqual(['たのむ', QUEST_ASK]);
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


it('ギルド詳細は共有データの条件/報酬を使い、受注前に納品消費を明示する', () => {
  const q = { ...Q2, reward: { itemId: 'herb', count: 7, power: 11 } };
  const lines = guildQuestDetailLines(q).join('\n');
  expect(lines).toContain('くすり あつめ');
  expect(lines).toContain('やくそう ×7 と あおぞらパワー 11');
  expect(lines).toContain('報告が 成功すると やくそうを 2 こ わたします');
  expect(lines).toContain('いまの 所持品も つかえます');
});

it('条件/報酬の行はギルド詳細と「クエスト」窓で同じ', () => {
  const q = { ...Q1, reward: { power: 3 } };
  expect(questTermsLine(q)).toBe(`条件: ${MON.name}を 3 たい。報酬: あおぞらパワー 3。`);
  expect(guildQuestDetailLines(q)).toContain(questTermsLine(q));
});
