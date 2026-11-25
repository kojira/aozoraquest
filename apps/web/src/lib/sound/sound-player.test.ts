// @vitest-environment jsdom
/** D-SOUND-001: はじめから ON・最初の操作まで鳴らない・ミュートで BGM/効果音/声のすべてが止まる。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeAudioContext } from './fake-audio-context.test-helper';
import { resetAudioContextForTest } from '../audio/audio-context';
import { getSoundSettings, resetSoundSettingsForTest, setSoundSetting } from './sound-store';
import { installSoundUnlock, resetSoundPlayerForTest, soundPlayer, SOUND_MUTE_ATTR } from './sound-player';
import { voicePlayer } from '../tts/voice-player';

let fake: ReturnType<typeof installFakeAudioContext>;
let uninstall: () => void;
beforeEach(() => {
  localStorage.clear();
  resetSoundSettingsForTest();
  resetAudioContextForTest();
  resetSoundPlayerForTest();
  fake = installFakeAudioContext();
  uninstall = installSoundUnlock();
});
afterEach(() => { uninstall(); vi.unstubAllGlobals(); });

const tap = (target: EventTarget = document.body) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
const loops = () => fake.sounds().filter((n) => n.loop);
const voiceAudio = { pcm: new Float32Array(400), sampleRate: 32000 };

describe('BGM と効果音 (D-SOUND-001)', () => {
  it('はじめから BGM も効果音も ON で、ミュートではない', () => {
    expect(getSoundSettings()).toEqual({ bgm: true, se: true, muted: false });
  });

  it('最初のタップより前は AudioContext を作らず何も鳴らさない。タップで場面の曲が始まる', () => {
    soundPlayer.setScene('field');
    soundPlayer.playSe('select');
    soundPlayer.playJingle('levelup');
    expect(fake.made).toHaveLength(0);
    tap();
    expect(fake.made).toHaveLength(1);
    expect(fake.ctx()!.resume).toHaveBeenCalled();
    expect(loops()).toHaveLength(1);
    expect(fake.audibleGain(loops()[0]!)).toBeGreaterThan(0);
  });

  it('キー入力でも起きる。ミュートボタンへのタップでは曲を始めない', () => {
    soundPlayer.setScene('field');
    const btn = document.createElement('button');
    btn.setAttribute(SOUND_MUTE_ATTR, '');
    document.body.append(btn);
    tap(btn);
    expect(fake.made).toHaveLength(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(loops()).toHaveLength(1);
    btn.remove();
  });

  it('戦闘で battle に替わり、前の曲は止まる。終わると field を頭から', () => {
    soundPlayer.setScene('field');
    tap();
    const field = loops()[0]!;
    soundPlayer.setScene('battle');
    expect(field.stopped).toBe(true);
    expect(loops()).toHaveLength(2);
    soundPlayer.setScene('field');
    expect(loops()).toHaveLength(3);
    expect(loops()[1]!.stopped).toBe(true);
  });

  it('効果音が鳴る。同じ効果音は 50ms 以内に重ねない', () => {
    tap();
    soundPlayer.playSe('confirm');
    soundPlayer.playSe('confirm');
    expect(fake.sounds()).toHaveLength(1);
    expect(fake.audibleGain(fake.sounds()[0]!)).toBeGreaterThan(0);
  });

  it('ミュートすると BGM・効果音・声のどれも聞こえない。声の設定は変えない。外すと戻る', () => {
    localStorage.setItem('aozoraquest:voice', 'on');
    soundPlayer.setScene('field');
    tap();
    const bgm = loops()[0]!;
    setSoundSetting('muted', true);
    expect(fake.audibleGain(bgm)).toBe(0);
    const before = fake.sounds().length;
    soundPlayer.playSe('hit');
    expect(fake.sounds()).toHaveLength(before);
    voicePlayer.play(voiceAudio);
    const voice = fake.sounds().at(-1)!;
    expect(voice.buffer!.length).toBe(400);
    expect(fake.audibleGain(voice)).toBe(0);
    expect(localStorage.getItem('aozoraquest:voice')).toBe('on');
    expect(localStorage.getItem('aozoraquest:mute')).toBe('on');
    setSoundSetting('muted', false);
    expect(fake.audibleGain(voice)).toBeGreaterThan(0);
    expect(loops().some((n) => !n.stopped && fake.audibleGain(n) > 0)).toBe(true);
  });

  it('設定で BGM だけ OFF にすると曲は止まり効果音は鳴る。リロードしても覚えている', () => {
    soundPlayer.setScene('field');
    tap();
    setSoundSetting('bgm', false);
    expect(loops()[0]!.stopped).toBe(true);
    soundPlayer.playSe('select');
    expect(fake.sounds().filter((n) => !n.loop)).toHaveLength(1);
    resetSoundSettingsForTest();
    expect(getSoundSettings()).toEqual({ bgm: false, se: true, muted: false });
  });

  it('声が話している間は BGM が下がり、終わると戻る', () => {
    soundPlayer.setScene('field');
    tap();
    const bgm = loops()[0]!;
    const full = fake.audibleGain(bgm);
    voicePlayer.play(voiceAudio);
    expect(fake.audibleGain(bgm)).toBeLessThan(full);
    voicePlayer.stop();
    expect(fake.audibleGain(bgm)).toBeCloseTo(full);
  });

  it('画面を隠すと止まり、戻ると続きから鳴る', () => {
    soundPlayer.setScene('field');
    tap();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.ctx()!.suspend).toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    fake.ctx()!.resume.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.ctx()!.resume).toHaveBeenCalled();
    expect(loops()).toHaveLength(1); // 同じ曲のまま (頭から作り直さない)
  });
});
