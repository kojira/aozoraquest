/**
 * 会話窓の今の行を声で読む (D-TTS-001)。声が ON で、行に voice の印があるときだけ。
 * 行が変わる・窓が閉じる (unmount) と止める。今の行を読み始めたら、次の声つきの行を先に合成しておく (1 行だけ)。
 */
import { useEffect, useRef } from 'react';
import type { DialogueLine } from '../dialogue';
import { ttsClient, TtsNotInstalledError, type TtsAudio } from './tts-client';
import { disableVoice, useVoiceState } from './voice-store';
import { voicePlayer } from './voice-player';
import { lineEmotion, lineSpeechText } from './tts-voice';

interface Speech { text: string; emotion: ReturnType<typeof lineEmotion> }

function speechOf(line: DialogueLine | null | undefined): Speech | null {
  if (!line?.voice) return null;
  const text = lineSpeechText(line.text);
  return text ? { text, emotion: lineEmotion(text, line.voice.expression) } : null;
}
const keyOf = (s: Speech) => `${JSON.stringify(s.emotion)}|${s.text}`;

/** lineKey: 行が変わったことを示す鍵 (段と行番号)。next: 同じ会話の次の行。 */
export function useLineVoice(line: DialogueLine | null, next: DialogueLine | undefined, lineKey: string): void {
  const { enabled } = useVoiceState();
  const prefetched = useRef(new Map<string, Promise<TtsAudio>>());
  const speech = enabled ? speechOf(line) : null;
  const nextSpeech = enabled ? speechOf(next) : null;
  const speechKey = speech ? keyOf(speech) : '';
  const nextKey = nextSpeech ? keyOf(nextSpeech) : '';

  useEffect(() => {
    voicePlayer.stop();
    if (!speech) return () => voicePlayer.stop();
    let live = true;
    const cache = prefetched.current;
    const take = (s: Speech) => {
      const k = keyOf(s);
      const p = cache.get(k) ?? ttsClient.speak(s.text, s.emotion);
      cache.delete(k);
      return p;
    };
    take(speech).then((a) => { if (live) voicePlayer.play(a); }, (e: unknown) => {
      if (e instanceof TtsNotInstalledError) disableVoice('声のデータが端末から消えていました。もう一度「🔊 声」を押すと読み込み直します。');
      else console.warn('[tts] speak failed', e);
    });
    if (nextSpeech && !cache.has(keyOf(nextSpeech))) {
      const p = ttsClient.speak(nextSpeech.text, nextSpeech.emotion);
      p.catch(() => undefined);
      cache.set(keyOf(nextSpeech), p);
    }
    return () => { live = false; voicePlayer.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 行 (lineKey) と読む文 (speechKey) が変わったときだけ
  }, [lineKey, speechKey, nextKey]);
}
