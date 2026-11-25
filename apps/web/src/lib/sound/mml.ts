/**
 * あおぞらワールドの曲の書き方 (D-SOUND-001)。1 チャンネル = 1 本の文字列 (MML 風)。
 *   c d e f g a b : 音 (+ / # でシャープ、- でフラット)。後ろに長さ (4=四分, 8=八分, 16, 32) と . (付点)
 *   r             : 休み            l8 : 既定の長さ      o5 : オクターブ   < > : オクターブを下げる/上げる
 *   v12           : 音量 0..15      @2 : 矩形波のデューティ (0=12.5% 1=25% 2=50% 3=75%)
 *   q6            : 音の長さの割合 (1..8 / 8。小さいほど歯切れよく)   t140 : テンポ (四分音符/分)
 *   ^-12          : 以後の音を、鳴るあいだに半音 n だけすべらせる (効果音用。^0 で戻す)
 *   [ ... ]3      : くり返し        $ : ここからループ (全チャンネル同じ拍に置く)   | : 小節線 (読むだけ)
 *   ノイズのチャンネルだけ: k (キック) s (スネア) h (ハイハット)。ふつうの音名も使え、高いほど明るいノイズ。
 */

export interface ChipNote {
  /** 始まり (拍)。 */
  beat: number;
  /** 長さ (拍)。 */
  beats: number;
  /** MIDI の音の高さ。ノイズの k/s/h は -1/-2/-3。 */
  midi: number;
  volume: number;
  duty: number;
  gate: number;
  /** 音のあいだに上げ下げする半音の数 (効果音用。0 なら一定)。 */
  slide: number;
}

export interface ChipTrack {
  notes: ChipNote[];
  /** 全体の長さ (拍)。 */
  beats: number;
  /** $ の位置 (拍)。無ければ null。 */
  loopBeat: number | null;
  /** t で決まったテンポ (最後の値)。 */
  tempo: number | null;
}

const SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export const DRUM: Record<string, number> = { k: -1, s: -2, h: -3 };

function expandRepeats(src: string): string {
  // 内側の [ ... ]n から順に開く
  const re = /\[([^[\]]*)\](\d*)/;
  let s = src;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const n = m[2] ? Number(m[2]) : 2;
    s = s.slice(0, m.index) + ` ${m[1]} `.repeat(n) + s.slice(m.index + m[0].length);
  }
  return s;
}

export function parseMml(source: string): ChipTrack {
  const s = expandRepeats(source.toLowerCase());
  const notes: ChipNote[] = [];
  let i = 0;
  let beat = 0;
  let octave = 4;
  let len = 8;
  let volume = 12;
  let duty = 2;
  let gate = 7;
  let slide = 0;
  let loopBeat: number | null = null;
  let tempo: number | null = null;

  const num = (): number | null => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const length = (): number => {
    const n = num() ?? len;
    let beats = 4 / n;
    let add = beats / 2;
    while (s[i] === '.') { beats += add; add /= 2; i++; }
    return beats;
  };

  while (i < s.length) {
    const ch = s[i++]!;
    if (' \n\t|'.includes(ch)) continue;
    if (ch in SEMITONE) {
      let semi = SEMITONE[ch]!;
      while (s[i] === '+' || s[i] === '#' || s[i] === '-') { semi += s[i] === '-' ? -1 : 1; i++; }
      const beats = length();
      notes.push({ beat, beats, midi: 12 * (octave + 1) + semi, volume, duty, gate, slide });
      beat += beats;
    } else if (ch in DRUM) {
      const beats = length();
      notes.push({ beat, beats, midi: DRUM[ch]!, volume, duty, gate, slide });
      beat += beats;
    } else if (ch === 'r') beat += length();
    else if (ch === 'o') octave = num() ?? octave;
    else if (ch === '<') octave--;
    else if (ch === '>') octave++;
    else if (ch === 'l') len = num() ?? len;
    else if (ch === 'v') volume = Math.min(15, num() ?? volume);
    else if (ch === '@') duty = Math.min(3, num() ?? duty);
    else if (ch === 'q') gate = Math.min(8, Math.max(1, num() ?? gate));
    else if (ch === 't') tempo = num() ?? tempo;
    else if (ch === '$') loopBeat = beat;
    else if (ch === '^') {
      const neg = s[i] === '-';
      if (neg || s[i] === '+') i++;
      slide = (num() ?? 0) * (neg ? -1 : 1);
    }
    else throw new Error(`MML: 読めない文字 "${ch}" (位置 ${i - 1})`);
  }
  return { notes, beats: beat, loopBeat, tempo };
}
