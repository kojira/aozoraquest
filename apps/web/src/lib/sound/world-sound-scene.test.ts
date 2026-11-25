/** D-SOUND-001 §3: 場面ごとの曲とジングル。 */
import { describe, expect, it } from 'vitest';
import { MONSTERS, setMonsterOverrides } from '@aozoraquest/core';
import { worldSound, type WorldSoundBattle } from './world-sound-scene';
import { battleLineSe } from './battle-line-se';

const b = (over: Partial<WorldSoundBattle> & { outcome?: string; monsterId?: string; story?: { canFlee: boolean } }): WorldSoundBattle => ({
  battleId: 'b1', phase: over.phase ?? 'message',
  state: { monsterId: over.monsterId ?? 'none', outcome: (over.outcome ?? 'ongoing') as never, ...(over.story ? { story: over.story } : {}) },
  ...(over.awarded ? { awarded: over.awarded } : {}),
});

describe('場面の曲 (D-SOUND-001)', () => {
  it('外は field、街と建物の中は town、読み込み前は曲なし', () => {
    expect(worldSound(true, null, false)).toEqual({ scene: 'field', jingle: null });
    expect(worldSound(true, null, true)).toEqual({ scene: 'town', jingle: null });
    expect(worldSound(false, null, false).scene).toBeNull();
  });
  it('ふつうの戦闘は battle、ストーリーの敵は boss', () => {
    expect(worldSound(true, b({}), true).scene).toBe('battle');
    expect(worldSound(true, b({ story: { canFlee: false } }), false).scene).toBe('boss');
    const base = [...MONSTERS];
    setMonsterOverrides([...base, { ...base[0]!, id: 'test-boss', storyOnly: true }]);
    expect(worldSound(true, b({ monsterId: 'test-boss' }), false).scene).toBe('boss');
    expect(worldSound(true, b({ monsterId: base[0]!.id }), false).scene).toBe('battle');
    setMonsterOverrides(base);
  });
  it('勝ったら victory (レベルが上がったら levelup も)、負けたら曲を止めて defeat', () => {
    expect(worldSound(true, b({ phase: 'result', outcome: 'win' }), false)).toEqual({ scene: 'victory', jingle: null });
    expect(worldSound(true, b({ phase: 'result', outcome: 'win', awarded: { leveledUp: { to: 2 } } }), false).jingle).toEqual({ id: 'levelup', key: 'b1:levelup' });
    expect(worldSound(true, b({ phase: 'result', outcome: 'lose' }), false)).toEqual({ scene: null, jingle: { id: 'defeat', key: 'b1:defeat' } });
  });
});

describe('戦闘の行の効果音 (D-SOUND-001 §4)', () => {
  it('味方の攻撃は hit、敵からは damage、会心・じゅもん・回復・たおした', () => {
    expect(battleLineSe('スライムに5のダメージ', 'player')).toBe('hit');
    expect(battleLineSe('たびびとに8のダメージ', 'monster')).toBe('damage');
    expect(battleLineSe('会心の一撃!! スライムに20のダメージ')).toBe('critical');
    expect(battleLineSe('たびびとの魔法!')).toBe('spell');
    expect(battleLineSe('スライムに5のダメージ。スライムをたおした!')).toBe('defeat');
    expect(battleLineSe('HPが12回復。')).toBe('heal');
  });
});
