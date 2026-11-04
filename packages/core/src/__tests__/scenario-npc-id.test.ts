/**
 * お知らせを話す NPC (#907)。目を覚ました鳥が、お知らせのあとに自分で話す。
 * 存在しない NPC・お知らせの無い行は保存させない。NPC を消すときの逆参照にも入る。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setScenario, scenarioEvents, type ScenarioEvent } from '../scenario.js';
import { setNpcs, type NpcDef } from '../npc-data.js';
import { danglingRefs } from '../world-refs.js';

const BIRD: NpcDef = { id: 'homura-bird', name: 'ほむら', x: 7, y: 3, lines: ['ふう'] };
const voice: ScenarioEvent = { id: 'v1', title: '声', when: [{ kind: 'flag', flag: 'homura_awake' }], setFlags: ['homura_voice'], notice: 'よく寝た', npcId: 'homura-bird' };

afterEach(() => { setScenario(null); setNpcs(null); });

describe('validateScenario: npcId (#907)', () => {
  it('実在する NPC なら受理し、setScenario 後も保持する', () => {
    setNpcs([BIRD]);
    setScenario([voice]);
    expect(scenarioEvents()[0]!.npcId).toBe('homura-bird');
  });
  it('存在しない NPC を拒否する', () => {
    setNpcs([BIRD]);
    expect(() => setScenario([{ ...voice, npcId: 'nobody' }])).toThrow(/話す NPC が存在しない \(nobody\)/);
  });
  it('お知らせの無い行に NPC を付けるのを拒否する', () => {
    setNpcs([BIRD]);
    const { notice: _n, ...silent } = voice;
    expect(() => setScenario([silent])).toThrow(/話す NPC にはお知らせが必要/);
  });
  it('話す NPC は逆参照に入る (消すと保存を止める)', () => {
    setNpcs([BIRD]);
    setScenario([voice]);
    expect(danglingRefs('npc', [])).toEqual([{ kind: 'npc', id: 'homura-bird', from: 'シナリオ「声」' }]);
    expect(danglingRefs('npc', ['homura-bird'])).toEqual([]);
  });
});
