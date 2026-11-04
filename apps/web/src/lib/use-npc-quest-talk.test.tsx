// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MONSTERS, setGameQuests, setNpcs, setStory, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { guildReception } from './npc-talk';
import { PARTY_LINES } from './party-lines';
import { useNpcQuestTalk } from './use-npc-quest-talk';

const MON = MONSTERS[0]!;
const quest = (id: string, title: string): GameQuestDef => ({ id, title, npcId: 'desk', intro: ['たのむ'], done: ['ありがとう'], objective: { kind: 'defeat', monsterId: MON.id, count: 1 } });
const DESK: NpcDef = { id: 'desk', name: 'うけつけ', x: 1, y: 1, lines: ['やあ'] };

const render = () => renderHook(() => useNpcQuestTalk({
  agent: null, moveBusyRef: { current: false }, tokenRef: { current: undefined }, flagsRef: { current: [] }, materialsRef: { current: {} },
  applyServerMaterials: () => {}, setServerPower: () => {}, setNotice: () => {}, waitForFreshDirectionRef: { current: false }, startEncounterRef: { current: () => {} },
}));
const viewGuildQuests = (r: ReturnType<typeof render>['result']) => {
  act(() => r.current.setNpcTalk(guildReception(DESK)));
  act(() => { void r.current.npcChoices!.find(c => c.label.startsWith('依頼を見る'))!.onSelect(); });
};

describe('useNpcQuestTalk ギルドの「依頼を見る」', () => {
  beforeEach(() => { setNpcs([DESK]); setGameQuests([quest('a', '達成した依頼'), quest('b', 'つぎの依頼'), quest('c', 'もうひとつ')]); });
  afterEach(() => { setGameQuests(null); setNpcs(null); });

  it('達成済みの依頼は一覧の件数に入らない', () => {
    const { result } = render();
    act(() => result.current.setQuest({ activeQuests: [], done: ['a'] }));
    viewGuildQuests(result);
    expect(result.current.npcTalk?.lines).toEqual(['どの依頼のこと？（1/1）']);
    expect(result.current.npcChoices?.map(c => c.label)).toEqual(['つぎの依頼 / 未受注', 'もうひとつ / 未受注', '戻る']);
  });

  it('すべて達成済みなら「いま紹介できる依頼はないよ。」だけで、説明は流さない', () => {
    const { result } = render();
    act(() => result.current.setQuest({ activeQuests: [], done: ['a', 'b', 'c'] }));
    viewGuildQuests(result);
    expect(result.current.npcTalk?.lines).toEqual(['いま紹介できる依頼はないよ。']);
  });
});

describe('useNpcQuestTalk ギルドの「なかまを さがす」(D-PARTY-001)', () => {
  const GUILD: NpcDef = { ...DESK, guildReception: true };
  const flagsRef = { current: [] as string[] };
  const renderWith = () => renderHook(() => useNpcQuestTalk({
    agent: null, moveBusyRef: { current: false }, tokenRef: { current: undefined }, flagsRef, materialsRef: { current: {} },
    applyServerMaterials: () => {}, setServerPower: () => {}, setNotice: () => {}, waitForFreshDirectionRef: { current: false }, startEncounterRef: { current: () => {} },
  }));
  beforeEach(() => { setNpcs([GUILD]); setStory({ recruits: [{ id: 'r', name: 'カイト', archetype: 'warrior', guild: 'desk', line: 'よろしく。' }] }); });
  afterEach(() => { setStory(null); setNpcs(null); flagsRef.current = []; });
  const labels = (r: ReturnType<typeof renderWith>['result']) => r.current.npcChoices?.map(c => c.label);

  it('第1章の終わり (futaba_letter_done) から出る。ガチャ (D-PARTY-002) では名前つきの冒険者がいなくても毎日来るので出る', () => {
    const { result } = renderWith();
    act(() => result.current.setNpcTalk(guildReception(GUILD)));
    expect(labels(result)).not.toContain('なかまを さがす');
    flagsRef.current = ['futaba_letter_done'];
    act(() => result.current.setNpcTalk(guildReception(GUILD)));
    expect(labels(result)).toEqual(['依頼を見る', '報告する', 'なかまを さがす', '話す', 'やめる']);
    setStory({ recruits: [] });
    act(() => result.current.setNpcTalk(guildReception(GUILD)));
    expect(labels(result)).toContain('なかまを さがす');
  });

  it('選ぶと guild: party の段になる (編成画面を開く)', () => {
    flagsRef.current = ['futaba_letter_done'];
    const { result } = renderWith();
    act(() => result.current.setNpcTalk(guildReception(GUILD)));
    act(() => { void result.current.npcChoices!.find(c => c.label === 'なかまを さがす')!.onSelect(); });
    expect(result.current.npcTalk?.guild).toBe('party');
  });
});

describe('useNpcQuestTalk 受付のメニューと「話す」', () => {
  const herb = 'herb';
  const FUTABA: NpcDef = { id: 'futaba', name: 'ふたば', x: 1, y: 1, guildReception: true, lines: ['やあ'],
    altLines: [{ flags: ['futaba_wings_done'], lines: ['小鳥が手紙を運んできたの。'] }] };
  const letter: GameQuestDef = { id: 'futaba-letter', title: 'ことりのおれい', npcId: 'futaba', personal: true, requireFlags: ['futaba_wings_done'],
    intro: ['小鳥が、おなかをすかせてるの。'], done: ['ありがとう'], objective: { kind: 'collect', itemId: herb, count: 1 } };
  const board: GameQuestDef = { ...quest('tool', '道具の手入れ'), npcId: 'futaba' };
  const flagsRef = { current: ['futaba_wings_done'] as string[] };
  const renderGuild = () => renderHook(() => useNpcQuestTalk({
    agent: null, moveBusyRef: { current: false }, tokenRef: { current: undefined }, flagsRef, materialsRef: { current: {} },
    applyServerMaterials: () => {}, setServerPower: () => {}, setNotice: () => {}, waitForFreshDirectionRef: { current: false }, startEncounterRef: { current: () => {} },
  }));
  const choose = (r: ReturnType<typeof renderGuild>['result'], label: string) => {
    let ret: unknown;
    act(() => { ret = r.current.npcChoices!.find(c => c.label === label)!.onSelect(); });
    return ret;
  };
  beforeEach(() => { setNpcs([FUTABA]); setGameQuests([board, letter]); flagsRef.current = ['futaba_wings_done']; });
  afterEach(() => { setGameQuests(null); setNpcs(null); });

  it('依頼を見る・報告する に件数を半角かっこで出す。0件なら件数なし。個人の頼みごとは 依頼を見る に数えない', () => {
    const { result } = renderGuild();
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    expect(result.current.npcChoices?.map(c => c.label)).toEqual(['依頼を見る(1)', '報告する', '話す', 'やめる']);
    act(() => result.current.setQuest({ activeQuests: [{ id: 'futaba-letter', progress: 0 }], done: [] }));
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    expect(result.current.npcChoices?.map(c => c.label)).toEqual(['依頼を見る(1)', '報告する(1)', '話す', 'やめる']);
  });

  it('依頼を見る は個人の頼みごとを出さない', () => {
    const { result } = renderGuild();
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    choose(result, '依頼を見る(1)');
    expect(result.current.npcTalk?.guild).toBe('detail');
    expect(result.current.npcTalk?.acceptQuestId).toBe('tool');
  });

  it('話す は通信を待たずに、その場で受付の人のセリフに進む (メニューのあいさつを出し直さない)', () => {
    setGameQuests([board]);
    const { result } = renderGuild();
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    const ret = choose(result, '話す');
    expect(ret).toBeUndefined();
    expect(result.current.npcTalk?.lines).toEqual(['小鳥が手紙を運んできたの。']);
    expect(result.current.npcTalk?.guild).toBe('message');
  });

  it('話す は倒れた仲間がいれば (読めている party から) 宿屋をすすめる', () => {
    setGameQuests([board]);
    const { result } = renderGuild();
    act(() => result.current.setParty({ ids: ['r'], hp: { r: 0 } }));
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    choose(result, '話す');
    expect(result.current.npcTalk?.lines).toEqual([PARTY_LINES.hurt, '小鳥が手紙を運んできたの。']);
  });

  it('話す はセリフに続けて個人の頼みごとを頼み、はい/いいえ を出す', () => {
    const { result } = renderGuild();
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    choose(result, '話す');
    expect(result.current.npcTalk?.lines).toEqual(['小鳥が手紙を運んできたの。', '小鳥が、おなかをすかせてるの。', 'うけますか？']);
    expect(result.current.npcTalk?.acceptQuestId).toBe('futaba-letter');
    expect(result.current.npcChoices?.map(c => c.label)).toEqual(['はい', 'いいえ']);
  });

  it('報告する は受注中の個人の頼みごとも出す', () => {
    const { result } = renderGuild();
    act(() => result.current.setQuest({ activeQuests: [{ id: 'futaba-letter', progress: 0 }], done: [] }));
    act(() => result.current.setNpcTalk(guildReception(FUTABA)));
    choose(result, '報告する(1)');
    expect(result.current.npcChoices?.map(c => c.label)).toEqual(['ことりのおれい / やくそうを1こ (0/1)', '戻る']);
  });
});
