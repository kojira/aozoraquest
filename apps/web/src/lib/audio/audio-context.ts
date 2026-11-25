/**
 * あおぞらワールドの音の出口 (D-SOUND-001 / D-TTS-001)。AudioContext は 1 つだけ作って、声・BGM・効果音で使い回す。
 * iOS Safari は、ユーザー操作の中で resume / 再生した AudioContext でないと音が出ないので、
 * タップの中で unlockAudio() (resume + 無音を 1 サンプル) を呼ぶ。
 * すべての音は masterOutput() へつなぐ。ミュート (sound-store の muted) のあいだは master の音量を 0 にする
 * = BGM・効果音・声のどれも鳴らない (D-SOUND-001)。
 */
import { getSoundSettings, subscribeSoundSettings } from '../sound/sound-store';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** まだ作っていなければ作る。作れない環境 (古いブラウザ・テスト) では null。 */
export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  ctx = Ctor ? new Ctor() : null;
  return ctx;
}

/** 作らずに、いまの AudioContext を返す (最初のタップの前は null)。 */
export function existingAudioContext(): AudioContext | null { return ctx; }

/** 声・BGM・効果音のつなぎ先 (master)。ここの音量 0 = ゲームの音をぜんぶ止める。 */
export function masterOutput(): GainNode | null {
  if (master) return master;
  const c = audioContext();
  if (!c) return null;
  const g = c.createGain();
  g.gain.value = getSoundSettings().muted ? 0 : 1;
  g.connect(c.destination);
  subscribeSoundSettings(() => { g.gain.value = getSoundSettings().muted ? 0 : 1; });
  master = g;
  return g;
}

/** タップ・キー入力の中から呼ぶ (同期で)。音を出せる状態にする。 */
export function unlockAudio(): void {
  const c = audioContext();
  if (!c) return;
  void c.resume().catch(() => undefined);
  const src = c.createBufferSource();
  src.buffer = c.createBuffer(1, 1, c.sampleRate);
  src.connect(c.destination);
  src.start();
}

// 声が話しているあいだ BGM を下げるための知らせ (voice-player → sound-player)。
let speaking = false;
const speakingListeners = new Set<(on: boolean) => void>();
export function setVoiceSpeaking(on: boolean): void {
  if (speaking === on) return;
  speaking = on;
  for (const l of speakingListeners) l(on);
}
export function isVoiceSpeaking(): boolean { return speaking; }
export function subscribeVoiceSpeaking(l: (on: boolean) => void): () => void {
  speakingListeners.add(l);
  return () => speakingListeners.delete(l);
}

export function resetAudioContextForTest(): void {
  ctx = null;
  master = null;
  speaking = false;
  speakingListeners.clear();
}
