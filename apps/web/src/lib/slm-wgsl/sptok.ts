/**
 * sarashina の SentencePiece Unigram トークナイザ (byte_fallback あり)。tokenizer.json (Unigram の語彙とスコア) を読む。
 * 試作 (~/.pi/slm-wgsl/web/src/sptok.ts) を移植: @huggingface/tokenizers の Unigram は byte_fallback を持たず、
 * 改行や絵文字が <unk> になるため自前で持つ。
 */
export interface UnigramJson { added_tokens: { id: number; content: string }[]; model: { unk_id: number; vocab: [string, number][] } }

export class SpTokenizer {
  private ids = new Map<string, number>();
  private scores: number[];
  private pieces: string[];
  private special: Map<string, number>;
  private specialRe: RegExp;
  private maxLen = 1;
  private unkScore: number;
  private byteId: number[] = [];

  constructor(j: UnigramJson) {
    this.pieces = j.model.vocab.map((v) => v[0]);
    this.scores = j.model.vocab.map((v) => v[1]);
    this.special = new Map(j.added_tokens.map((t) => [t.content, t.id]));
    j.model.vocab.forEach(([p], i) => {
      if (this.special.has(p) || i === j.model.unk_id) return;
      const m = /^<0x([0-9A-F]{2})>$/.exec(p);
      if (m) { this.byteId[parseInt(m[1]!, 16)] = i; return; }
      this.ids.set(p, i);
      this.maxLen = Math.max(this.maxLen, [...p].length);
    });
    // spread は Worker の小さいスタックで 10 万件を渡せないのでループで最小値を取る
    this.unkScore = this.scores.reduce((m, v) => Math.min(m, v), Infinity) - 10;
    const esc = [...this.special.keys()].sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this.specialRe = new RegExp(`(${esc.join('|')})`);
  }

  encode(text: string): number[] {
    const out: number[] = [];
    for (const part of text.split(this.specialRe)) {
      if (!part) continue;
      const sp = this.special.get(part);
      if (sp !== undefined) out.push(sp); else out.push(...this.viterbi(part.replaceAll(' ', '\u2581')));
    }
    return out;
  }

  private viterbi(s: string): number[] {
    const ch = [...s];
    const n = ch.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1);
    const tok = new Int32Array(n + 1); // -1 = unknown char (byte fallback)
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let single = false;
      let piece = '';
      for (let l = 1; l <= this.maxLen && i + l <= n; l++) {
        piece += ch[i + l - 1];
        const id = this.ids.get(piece);
        if (id === undefined) continue;
        if (l === 1) single = true;
        const sc = best[i]! + this.scores[id]!;
        if (sc > best[i + l]!) { best[i + l] = sc; from[i + l] = i; tok[i + l] = id; }
      }
      if (!single) {
        const sc = best[i]! + this.unkScore;
        if (sc > best[i + 1]!) { best[i + 1] = sc; from[i + 1] = i; tok[i + 1] = -1; }
      }
    }
    const rev: number[][] = [];
    for (let e = n; e > 0; e = from[e]!) {
      if (tok[e] === -1) rev.push([...new TextEncoder().encode(ch[e - 1]!)].map((b) => this.byteId[b]!));
      else rev.push([tok[e]!]);
    }
    return rev.reverse().flat();
  }

  decode(ids: number[], opts: { skip_special_tokens?: boolean } = {}): string {
    const bytes: number[] = [];
    const enc = new TextEncoder();
    for (const id of ids) {
      const p = this.pieces[id] ?? '';
      if (this.special.has(p) && opts.skip_special_tokens) continue;
      const b = this.byteId.indexOf(id);
      if (b >= 0) bytes.push(b); else bytes.push(...enc.encode(p.replaceAll('\u2581', ' ')));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}
