// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MONSTERS, setGameQuests, setNpcs, setStory, type GameQuestDef, type NpcDef } from '@aozoraquest/core';
import { guildReception } from './npc-talk';
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
  act(() => { void r.current.npcChoices!.find(c => c.label === '依頼を見る')!.onSelect(); });
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
