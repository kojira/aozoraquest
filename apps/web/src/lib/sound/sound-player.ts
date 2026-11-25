/**
 * あおぞらワールドの BGM と効果音を鳴らす係 (D-SOUND-001)。
 * - 最初のタップ / キー入力より前は AudioContext を作らない・何も鳴らさない (ブラウザが音を止めるため)。
 *   installSoundUnlock() が最初の操作で 1 回だけ音を起こし、そのとき決まっている場面の曲を始める。
 * - BGM: 曲は鳴らす前に 1 回だけ PCM にし (chip-synth)、AudioBufferSourceNode の loop で継ぎ目なく回す。
 *   曲が替わるときは 0.3 秒で下げて次へ。声が話している間は BGM を下げる。
 * - 効果音: 初めて鳴らすときに PCM にして覚えておく。同じ音は 50ms 以内に重ねない。
 * - 画面が隠れたら止め (suspend)、見えたら続きから (resume)。
 * つなぎ方: BGM → bgmBus → master、効果音 → seBus → master、声 → master (audio-context)。
 */
import { audioContext, existingAudioContext, isVoiceSpeaking, masterOutput, subscribeVoiceSpeaking, unlockAudio } from '../audio/audio-context';
import { voicePlayer } from '../tts/voice-player';
import { renderSong, type ChipPcm, type ChipSong } from './chip-synth';
import { JINGLES, SONGS, type JingleId, type SongId } from './songs';
import { SE, type SeId } from './se';
import { getSoundSettings, subscribeSoundSettings } from './sound-store';

const BGM_LEVEL = 0.5;
const SE_LEVEL = 0.8;
/** 声・ジングルのあいだの BGM (BGM_LEVEL に掛ける)。 */
const DUCK = 0.3;
const FADE_OUT = 0.3;
const DUCK_DOWN = 0.1;
const DUCK_UP = 0.4;
const SE_GAP_MS = 50;
/** ミュートボタンの印。このボタンへのタップでは、音を起こしても曲を始めない (押してすぐ鳴らないように)。 */
export const SOUND_MUTE_ATTR = 'data-sound-mute';

/** いま鳴っている曲 (と、戦闘から戻るとき用に 1 つ前) の PCM だけ覚える。ジングルは別。 */
const songCache = new Map<string, ChipPcm>();
const seCache = new Map<SeId, ChipPcm>();
const seLastAt = new Map<SeId, number>();

let unlocked = false;
let scene: SongId | null = null;
let playing: { id: SongId; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let bgmBus: GainNode | null = null;
let seBus: GainNode | null = null;
let jingles = 0;

function pcmOf(song: ChipSong, keep: 'song' | 'jingle'): ChipPcm {
  const hit = songCache.get(song.id);
  if (hit) { songCache.delete(song.id); songCache.set(song.id, hit); return hit; }
  const p = renderSong(song);
  songCache.set(song.id, p);
  if (keep === 'song') {
    const songs = [...songCache.keys()].filter((k) => !(JINGLES as readonly string[]).includes(k));
    if (songs.length > 2) songCache.delete(songs[0]!);
  }
  return p;
}

function buses(): { c: AudioContext; bgm: GainNode; se: GainNode } | null {
  const c = audioContext();
  const out = masterOutput();
  if (!c || !out) return null;
  if (!bgmBus) {
    bgmBus = c.createGain();
    bgmBus.gain.value = BGM_LEVEL * (isVoiceSpeaking() ? DUCK : 1);
    bgmBus.connect(out);
    seBus = c.createGain();
    seBus.gain.value = SE_LEVEL;
    seBus.connect(out);
  }
  return { c, bgm: bgmBus, se: seBus! };
}

function source(c: AudioContext, p: ChipPcm): AudioBufferSourceNode {
  const buf = c.createBuffer(1, p.pcm.length, p.sampleRate);
  buf.copyToChannel(p.pcm as Float32Array<ArrayBuffer>, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  if (p.loopStart !== null && p.loopEnd !== null) {
    src.loop = true;
    src.loopStart = p.loopStart / p.sampleRate;
    src.loopEnd = p.loopEnd / p.sampleRate;
  }
  return src;
}

function canPlay(kind: 'bgm' | 'se'): boolean {
  const s = getSoundSettings();
  return unlocked && s[kind] && !s.muted;
}

function stopBgm(): void {
  const p = playing;
  playing = null;
  if (!p) return;
  const c = existingAudioContext();
  if (!c) return;
  const t = c.currentTime;
  p.gain.gain.cancelScheduledValues(t);
  p.gain.gain.setValueAtTime(p.gain.gain.value, t);
  p.gain.gain.linearRampToValueAtTime(0, t + FADE_OUT);
  try { p.src.stop(t + FADE_OUT); } catch { /* already stopped */ }
}

/** いまの場面と設定に合わせて BGM を始める・替える・止める。 */
function syncBgm(): void {
  const want = canPlay('bgm') ? scene : null;
  if (playing?.id === want) return;
  stopBgm();
  if (!want) return;
  const b = buses();
  if (!b) return;
  const src = source(b.c, pcmOf(SONGS[want], 'song'));
  const gain = b.c.createGain();
  src.connect(gain);
  gain.connect(b.bgm);
  src.start();
  playing = { id: want, src, gain };
}

function duckBgm(): void {
  if (!bgmBus) return;
  const c = existingAudioContext();
  if (!c) return;
  const down = isVoiceSpeaking() || jingles > 0;
  const t = c.currentTime;
  bgmBus.gain.cancelScheduledValues(t);
  bgmBus.gain.setValueAtTime(bgmBus.gain.value, t);
  bgmBus.gain.linearRampToValueAtTime(BGM_LEVEL * (down ? DUCK : 1), t + (down ? DUCK_DOWN : DUCK_UP));
}

export const soundPlayer = {
  /** 今の場面の曲 (null = 曲なし)。最初の操作の前に決めておけば、最初の操作で始まる。 */
  setScene(id: SongId | null): void {
    scene = id;
    syncBgm();
  },
  playSe(id: SeId): void {
    if (!canPlay('se')) return;
    const now = performance.now();
    if (now - (seLastAt.get(id) ?? -Infinity) < SE_GAP_MS) return;
    seLastAt.set(id, now);
    const b = buses();
    if (!b) return;
    let p = seCache.get(id);
    if (!p) { p = renderSong(SE[id]); seCache.set(id, p); }
    const src = source(b.c, p);
    src.connect(b.se);
    src.start();
  },
  /** 短い曲 (レベルアップ・宿屋・負け)。BGM は止めずに下げ、終わったら戻す。BGM の設定に従う。 */
  playJingle(id: JingleId): void {
    if (!canPlay('bgm')) return;
    const b = buses();
    if (!b) return;
    const src = source(b.c, pcmOf(SONGS[id], 'jingle'));
    src.connect(b.se);
    jingles++;
    duckBgm();
    src.onended = () => { jingles = Math.max(0, jingles - 1); duckBgm(); };
    src.start();
  },
  /** ユーザーの操作の中から呼ぶ。音を起こして、いまの場面の曲を始める。 */
  unlock(): void {
    unlockAudio();
    unlocked = true;
    syncBgm();
  },
  isUnlocked(): boolean { return unlocked; },
};

/**
 * 最初のタップ / キー入力で音を起こす。AudioContext が動き出すまで (iOS は pointerdown では起きないことがある)
 * 次の操作でも起こし直し、動いたら外す。ミュートボタンへのタップは、ボタン自身が起こす (押した瞬間に曲が鳴らないように)。
 * 画面が隠れたら止め、見えたら続きから。設定が変わったら BGM を合わせる。戻り値で外す (ワールドを出るとき)。
 */
export function installSoundUnlock(): () => void {
  const events = ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown'] as const;
  const removeGesture = () => { for (const ev of events) window.removeEventListener(ev, onGesture, true); };
  function onGesture(e: Event): void {
    if (e.target instanceof Element && e.target.closest(`[${SOUND_MUTE_ATTR}]`)) return;
    soundPlayer.unlock();
    if (existingAudioContext()?.state === 'running') removeGesture();
  }
  if (!unlocked || existingAudioContext()?.state !== 'running') for (const ev of events) window.addEventListener(ev, onGesture, true);
  const onVisibility = () => {
    const c = existingAudioContext();
    if (!c) return;
    if (document.visibilityState === 'hidden') {
      voicePlayer.stop();
      void c.suspend().catch(() => undefined);
    } else if (unlocked) void c.resume().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisibility);
  const offSettings = subscribeSoundSettings(syncBgm);
  const offVoice = subscribeVoiceSpeaking(duckBgm);
  return () => {
    removeGesture();
    document.removeEventListener('visibilitychange', onVisibility);
    offSettings();
    offVoice();
  };
}

export function resetSoundPlayerForTest(): void {
  unlocked = false;
  scene = null;
  playing = null;
  bgmBus = null;
  seBus = null;
  jingles = 0;
  songCache.clear();
  seCache.clear();
  seLastAt.clear();
}
