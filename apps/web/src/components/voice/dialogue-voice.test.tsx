// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const speak = vi.fn(async () => ({ pcm: new Float32Array(4), sampleRate: 44100 }));
const play = vi.fn();
const stop = vi.fn();
vi.mock('@/lib/tts/tts-client', () => ({ ttsClient: { speak: (...a: unknown[]) => speak(...(a as [])), install: vi.fn(async () => undefined) } }));
vi.mock('@/lib/tts/voice-player', () => ({ voicePlayer: { unlock: vi.fn(), play: (a: unknown) => play(a), stop: () => stop() } }));
import { DialogueWindow } from '../dialogue-window';
import { resetVoiceForTest } from '@/lib/tts/voice-store';
import { PrivacyVoiceCredit } from './voice-toggle';

const V = { voice: 'bluesky' as const };
const LINES = [
  { speaker: 'Blueskyちゃん', text: '（小さな声で）……ようこそ。', voice: V },
  { speaker: 'Blueskyちゃん', text: 'ずっと逆光で、ごめんね。', voice: V },
  { text: '少女はやくそうを取り出した。' },
];
beforeEach(() => { localStorage.clear(); speak.mockClear(); play.mockClear(); stop.mockClear(); });

describe('Blueskyちゃんの声 in the dialogue window (D-TTS-001)', () => {
  it('voice OFF: no toggle-triggered speech; the toggle is shown only for conversations with a voiced line', () => {
    resetVoiceForTest();
    const { unmount } = render(<DialogueWindow lines={LINES} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: '🔊 声' }).getAttribute('aria-pressed')).toBe('false');
    expect(speak).not.toHaveBeenCalled();
    unmount();
    render(<DialogueWindow lines={[{ speaker: 'むらおさ', text: 'やあ' }]} onDone={() => {}} />);
    expect(screen.queryByRole('button', { name: '🔊 声' })).toBeNull();
  });
  it('voice ON: speaks the line (stage directions removed, emotion by rule), prefetches the next, stops on advance and on close', async () => {
    localStorage.setItem('aozoraquest:voice', 'on');
    resetVoiceForTest();
    const onDone = vi.fn();
    const { unmount } = render(<DialogueWindow lines={LINES} onDone={onDone} />);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(speak).toHaveBeenCalledWith('……ようこそ。', { neutral: 100 });
    expect(speak).toHaveBeenCalledWith('ずっと逆光で、ごめんね。', { apologetic: 70, neutral: 30 }); // prefetch
    const surface = screen.getAllByRole('dialog')[0]!;
    stop.mockClear();
    act(() => { fireEvent.click(surface); }); act(() => { fireEvent.click(surface); });
    expect(stop).toHaveBeenCalled();
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls.filter((c) => (c as unknown[])[0] === 'ずっと逆光で、ごめんね。')).toHaveLength(1); // the prefetch was used
    stop.mockClear();
    act(() => { fireEvent.click(surface); }); act(() => { fireEvent.click(surface); });
    expect(stop).toHaveBeenCalled(); // narration line: nothing plays
    stop.mockClear();
    unmount();
    expect(stop).toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(2);
  });
  it('tapping the toggle does not advance the dialogue', () => {
    resetVoiceForTest();
    const onDone = vi.fn();
    render(<DialogueWindow lines={LINES.slice(0, 1)} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: '🔊 声' }));
    fireEvent.click(screen.getByRole('button', { name: '🔊 声' }));
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ZEN-TTS credit (licence §3.1)', () => {
  it('shows 「音声合成：ZEN-TTS（https://zenryokukikai.com ）」 with the URL as a link', () => {
    render(<PrivacyVoiceCredit />);
    const link = screen.getByRole('link', { name: 'https://zenryokukikai.com' });
    expect(link.getAttribute('href')).toBe('https://zenryokukikai.com');
    expect(link.parentElement!.textContent).toContain('音声合成：ZEN-TTS（https://zenryokukikai.com ）');
  });
});
