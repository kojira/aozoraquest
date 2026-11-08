// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const install = vi.fn();
const unlock = vi.fn();
const stop = vi.fn();
vi.mock('./tts-client', () => ({ ttsClient: { install: (p: (l: number, t: number) => void) => install(p) } }));
vi.mock('./voice-player', () => ({ voicePlayer: { unlock: () => unlock(), stop: () => stop(), play: vi.fn() } }));
import { getVoiceState, resetVoiceForTest, toggleVoice } from './voice-store';

beforeEach(() => { localStorage.clear(); resetVoiceForTest(); install.mockReset(); unlock.mockReset(); stop.mockReset(); });

describe('voice toggle (D-TTS-001)', () => {
  it('is off by default', () => {
    expect(getVoiceState()).toEqual({ enabled: false, installing: null, error: null });
  });
  it('turning on unlocks audio inside the tap, downloads with progress, then remembers ON', async () => {
    let report!: (l: number, t: number) => void;
    let finish!: () => void;
    install.mockImplementation((p) => { report = p; return new Promise<void>((r) => { finish = r; }); });
    toggleVoice();
    expect(unlock).toHaveBeenCalledTimes(1); // synchronously, in the user gesture (iOS)
    report(10, 40);
    expect(getVoiceState().installing).toEqual({ loaded: 10, total: 40 });
    expect(getVoiceState().enabled).toBe(false);
    finish();
    await vi.waitFor(() => expect(getVoiceState()).toEqual({ enabled: true, installing: null, error: null }));
    expect(localStorage.getItem('aozoraquest:voice')).toBe('on');
  });
  it('a failed download stays off and says so; turning off stops playback', async () => {
    install.mockRejectedValue(new Error('net'));
    toggleVoice();
    await vi.waitFor(() => expect(getVoiceState().error).toBeTruthy());
    expect(getVoiceState().enabled).toBe(false);
    install.mockResolvedValue(undefined);
    toggleVoice();
    await vi.waitFor(() => expect(getVoiceState().enabled).toBe(true));
    toggleVoice();
    expect(getVoiceState().enabled).toBe(false);
    expect(stop).toHaveBeenCalled();
    expect(localStorage.getItem('aozoraquest:voice')).toBe('off');
  });
});
