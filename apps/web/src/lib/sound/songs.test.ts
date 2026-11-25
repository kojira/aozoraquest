/** D-SOUND-001 §8-7: どの曲も読めて、ループの継ぎ目がずれない。効果音も読める。 */
import { describe, expect, it } from 'vitest';
import { renderSong } from './chip-synth';
import { JINGLES, SONGS } from './songs';
import { SE } from './se';
import { battleLineSe } from './battle-line-se';

describe('曲と効果音のデータ (D-SOUND-001)', () => {
  it.each(Object.values(SONGS))('$id: PCM にでき、音が入っていて、割れない', (song) => {
    const p = renderSong(song);
    const peak = p.pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1);
  });
  it('場面の曲はループし、ループの終わり = PCM の終わり (継ぎ目がずれない)。ジングルはループしない', () => {
    for (const song of [SONGS.field, SONGS.field2, SONGS.field3, SONGS.town, SONGS.title, SONGS.battle, SONGS.boss, SONGS.final, SONGS.victory, SONGS.casino]) {
      const p = renderSong(song);
      expect(p.loopStart).toBeGreaterThanOrEqual(0);
      expect(p.loopStart!).toBeLessThan(p.loopEnd!);
      expect(p.loopEnd).toBe(p.pcm.length);
    }
    for (const id of JINGLES) expect(renderSong(SONGS[id]).loopStart).toBeNull();
  });
  it('チャンネルの長さや $ の位置がずれた曲はエラーにする', () => {
    expect(() => renderSong({ id: 'bad', tempo: 120, pulse1: 'c4 $ c4 c4', triangle: 'c4 c4 $ c4' })).toThrow(/\$ の位置/);
    expect(() => renderSong({ id: 'bad', tempo: 120, pulse1: '$ c4 c4', triangle: '$ c4' })).toThrow(/拍/);
  });
  it.each(Object.values(SE))('効果音 $id は短く、ループしない', (se) => {
    const p = renderSong(se);
    expect(p.loopStart).toBeNull();
    expect(p.pcm.length / p.sampleRate).toBeLessThan(1.2);
  });
  it('効果音は 15 種そろっている', () => {
    expect(Object.keys(SE)).toEqual(['cursor', 'select', 'confirm', 'cancel', 'hit', 'critical', 'spell', 'heal', 'damage', 'defeat', 'item', 'chest', 'door', 'blocked', 'coin']);
  });
  it('戦闘の行: ダメージは hit、回復は heal、ほかは鳴らさない', () => {
    expect(battleLineSe('スライムに5のダメージ')).toBe('hit');
    expect(battleLineSe('HPが12回復。(残り2)')).toBe('heal');
    expect(battleLineSe('たびびとのこうげき!')).toBeNull();
  });
});
