/**
 * 声の再生 (D-TTS-001)。AudioContext は lib/audio/audio-context の 1 つを BGM・効果音と使い回す。
 * iOS Safari は、ユーザー操作の中で resume / 再生した AudioContext でないと音が出ないので、
 * トグルのタップの中で unlock() (= unlockAudio) を呼ぶ。
 * 話しているあいだは setVoiceSpeaking で知らせる (BGM を下げる。D-SOUND-001 §5)。
 */
import type { TtsAudio } from './tts-client';
import { audioContext, masterOutput, setVoiceSpeaking, unlockAudio } from '../audio/audio-context';

let current: AudioBufferSourceNode | null = null;

export const voicePlayer = {
  unlock(): void {
    unlockAudio();
  },
  play(a: TtsAudio): void {
    const c = audioContext();
    const out = masterOutput();
    if (!c || !out) return;
    voicePlayer.stop();
    if (c.state === 'suspended') void c.resume().catch(() => undefined);
    const buf = c.createBuffer(1, a.pcm.length, a.sampleRate);
    buf.copyToChannel(a.pcm as Float32Array<ArrayBuffer>, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.onended = () => { if (current === src) { current = null; setVoiceSpeaking(false); } };
    current = src;
    setVoiceSpeaking(true);
    src.start();
  },
  stop(): void {
    const s = current;
    current = null;
    try { s?.stop(); } catch { /* already stopped */ }
    setVoiceSpeaking(false);
  },
};
