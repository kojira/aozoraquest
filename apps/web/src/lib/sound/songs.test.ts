/** D-SOUND-001 §8-7: どの曲も読めて、ループの継ぎ目がずれない。効果音も読める。 */
import { describe, expect, it } from 'vitest';
import { renderSong } from './chip-synth';
import { SONGS } from './songs';
import { SE } from './se';
import { battleLineSe } from './battle-line-se';

describe('曲と効果音のデータ (D-SOUND-001)', () => {
  it.each(Object.values(SONGS))('$id: PCM にでき、音が入っていて、割れない', (song) => {
    const p = renderSong(song);
    const peak = p.pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(1);
  });
  it('field と battle はループし、ループの終わり = PCM の終わり (継ぎ目がずれない)', () => {
    for (const song of [SONGS.field, SONGS.battle]) {
      const p = renderSong(song);
      expect(p.loopStart).toBeGreaterThan(0);
      expect(p.loopEnd).toBe(p.pcm.length);
    }
    expect(renderSong(SONGS.levelup).loopStart).toBeNull();
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
  it('戦闘の行: ダメージは hit、回復は heal、ほかは鳴らさない', () => {
    expect(battleLineSe('スライムに5のダメージ')).toBe('hit');
    expect(battleLineSe('HPが12回復。(残り2)')).toBe('heal');
    expect(battleLineSe('たびびとのこうげき!')).toBeNull();
  });
});
