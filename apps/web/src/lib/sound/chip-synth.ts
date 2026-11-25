/**
 * あおぞらワールドのチップ音源 (D-SOUND-001)。曲 1 つを PCM (Float32Array) にする純粋な関数。
 * ブラウザもプレビュー (node) も同じこの関数で音を作る = 試聴とゲームの音が同じになる。
 * チャンネルはファミコン風の 4 つ: 矩形波 2 (デューティ 4 種)・三角波 (16 段)・ノイズ (k/s/h のドラム付き)。
 */
import { parseMml, type ChipNote } from './mml';

export const CHIP_SAMPLE_RATE = 32000;

export interface ChipSong {
  id: string;
  /** 四分音符/分。 */
  tempo: number;
  pulse1?: string;
  pulse2?: string;
  triangle?: string;
  noise?: string;
}

export interface ChipPcm {
  pcm: Float32Array;
  sampleRate: number;
  /** ループの始まり・終わり (サンプル)。ループしない曲は null。 */
  loopStart: number | null;
  loopEnd: number | null;
}

type Channel = 'pulse1' | 'pulse2' | 'triangle' | 'noise';
const CHANNELS: Channel[] = ['pulse1', 'pulse2', 'triangle', 'noise'];
const GAIN: Record<Channel, number> = { pulse1: 0.26, pulse2: 0.2, triangle: 0.42, noise: 0.18 };
const DUTY = [0.125, 0.25, 0.5, 0.75];
const ATTACK = 0.002;
const RELEASE = 0.015;
/** 曲の終わりから鳴り残る音 (ドラムの減衰など) を拾う長さ (秒)。 */
const TAIL = 0.3;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** 16 ビットの LFSR (ファミコンのノイズと同じ形)。 */
function lfsr(): () => number {
  let r = 1;
  return () => {
    const bit = (r ^ (r >> 1)) & 1;
    r = (r >> 1) | (bit << 14);
    return r & 1 ? 1 : -1;
  };
}

function envelope(t: number, on: number, decay: number): number {
  const a = t < ATTACK ? t / ATTACK : 1;
  const d = decay > 0 ? Math.exp(-t / decay) : 1;
  const r = t <= on ? 1 : Math.max(0, 1 - (t - on) / RELEASE);
  return a * d * r;
}

function renderNote(out: Float32Array, ch: Channel, n: ChipNote, spb: number, sr: number): void {
  const start = Math.round(n.beat * spb * sr);
  const on = n.beats * spb * (n.gate / 8);
  const vol = (n.volume / 15) * GAIN[ch];
  const drum = n.midi < 0 ? n.midi : 0;
  const life = drum === -1 ? 0.12 : drum === -2 ? 0.16 : drum === -3 ? 0.04 : on + RELEASE;
  const len = Math.min(out.length - start, Math.ceil(life * sr));
  const noise = lfsr();
  let phase = 0;
  let held = 0;
  let clock = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    if (drum === -1) {
      // キック: 三角波が 160Hz から 45Hz へ落ちる
      phase += (45 + 115 * Math.exp(-t / 0.025)) / sr;
      s = 1 - 4 * Math.abs((phase % 1) - 0.5);
      s *= Math.exp(-t / 0.06) * 1.8;
    } else if (drum === -2 || drum === -3) {
      clock += (drum === -2 ? 9000 : 30000) / sr;
      if (clock >= 1) { clock -= Math.floor(clock); held = noise(); }
      s = held * Math.exp(-t / (drum === -2 ? 0.05 : 0.012));
    } else {
      const hz = midiHz(n.midi + (n.slide * Math.min(t, on)) / Math.max(on, 1e-3));
      if (ch === 'noise') {
        clock += Math.min(sr, hz * 32) / sr;
        if (clock >= 1) { clock -= Math.floor(clock); held = noise(); }
        s = held * envelope(t, on, 0.12);
      } else if (ch === 'triangle') {
        phase += hz / sr;
        const tri = 1 - 4 * Math.abs((phase % 1) - 0.5);
        s = (Math.round(tri * 7.5 + 7.5) - 7.5) / 7.5 * envelope(t, on, 0);
      } else {
        phase += hz / sr;
        s = ((phase % 1) < DUTY[n.duty]! ? 1 : -1) * (0.75 + 0.25 * envelope(t, on, 0.06)) * envelope(t, on, 0);
      }
    }
    out[start + i]! += s * vol;
  }
}

export function renderSong(song: ChipSong, sr: number = CHIP_SAMPLE_RATE): ChipPcm {
  const spb = 60 / song.tempo;
  const tracks = CHANNELS.flatMap((ch) => (song[ch] ? [{ ch, track: parseMml(song[ch]!) }] : []));
  const beats = Math.max(...tracks.map((t) => t.track.beats));
  const loops = tracks.map((t) => t.track.loopBeat);
  const loopBeat = loops.find((l) => l !== null) ?? null;
  if (loopBeat !== null) {
    // ループする曲は、全チャンネルが同じ拍で $ を通り、同じ拍で終わる (継ぎ目がずれない)
    for (const t of tracks) {
      if (Math.abs(t.track.beats - beats) > 1e-6) throw new Error(`${song.id}.${t.ch}: ${t.track.beats} 拍 (ほかは ${beats} 拍)`);
    }
    if (loops.some((l) => l !== loopBeat)) throw new Error(`${song.id}: $ の位置がチャンネルでずれている (${loops.join(', ')})`);
  }

  const end = Math.round(beats * spb * sr);
  const out = new Float32Array(end + Math.ceil(TAIL * sr));
  for (const { ch, track } of tracks) for (const n of track.notes) renderNote(out, ch, n, spb, sr);

  // ループする曲は終わりで切る (鳴り残りは捨てる。ループの頭へ戻る)
  const loopStart = loopBeat === null ? null : Math.round(loopBeat * spb * sr);
  const pcm = loopStart === null ? out : out.subarray(0, end);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.tanh(pcm[i]! * 1.2) / 1.2;
  return { pcm, sampleRate: sr, loopStart, loopEnd: loopStart === null ? null : end };
}
