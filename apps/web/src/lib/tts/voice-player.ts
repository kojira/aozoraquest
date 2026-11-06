/**
 * 声の再生 (D-TTS-001)。AudioContext は 1 つを使い回す。
 * iOS Safari は、ユーザー操作の中で resume / 再生した AudioContext でないと音が出ないので、
 * トグルのタップの中で unlock() (resume + 無音を 1 サンプル) を呼ぶ。
 */
import type { TtsAudio } from './tts-client';

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  ctx = Ctor ? new Ctor() : null;
  return ctx;
}

export const voicePlayer = {
  unlock(): void {
    const c = context();
    if (!c) return;
    void c.resume().catch(() => undefined);
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start();
  },
  play(a: TtsAudio): void {
    const c = context();
    if (!c) return;
    voicePlayer.stop();
    if (c.state === 'suspended') void c.resume().catch(() => undefined);
    const buf = c.createBuffer(1, a.pcm.length, a.sampleRate);
    buf.copyToChannel(a.pcm as Float32Array<ArrayBuffer>, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.onended = () => { if (current === src) current = null; };
    current = src;
    src.start();
  },
  stop(): void {
    const s = current;
    current = null;
    try { s?.stop(); } catch { /* already stopped */ }
  },
};
