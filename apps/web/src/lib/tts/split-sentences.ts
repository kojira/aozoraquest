/**
 * 台詞を文ごとに分ける (D-TTS-001 追加)。1 行まるごとより文ごとに合成したほうが読みが崩れにくい
 * (「Bluesky」など)。「。」「！」「？」と ASCII の ! ? の後で切り、続く閉じかっこ・引用符はその文に残す。
 */
const SENTENCE = /[^。！？!?]*[。！？!?]+[」』）)】〕〉》”’"']*|[^。！？!?]+$/g;

export function splitSentences(text: string): string[] {
  return (text.match(SENTENCE) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** 文と文のあいだの無音 (秒)。 */
const SENTENCE_GAP_SEC = 0.15;

/** 文ごとの PCM を、あいだに round(sampleRate*0.15) サンプルの無音をはさんで 1 本にする。 */
export function joinSentencePcm(pieces: Float32Array[], sampleRate: number): Float32Array {
  const gap = Math.round(sampleRate * SENTENCE_GAP_SEC);
  const out = new Float32Array(pieces.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, pieces.length - 1));
  let o = 0;
  pieces.forEach((p, i) => { if (i > 0) o += gap; out.set(p, o); o += p.length; });
  return out;
}
