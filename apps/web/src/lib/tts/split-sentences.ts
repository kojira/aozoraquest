/**
 * 台詞を文ごとに分ける (D-TTS-001 追加)。1 行まるごとより文ごとに合成したほうが読みが崩れにくい
 * (「Bluesky」など)。「。」「！」「？」と ASCII の ! ? の後で切り、続く閉じかっこ・引用符はその文に残す。
 */
const SENTENCE = /[^。！？!?]*[。！？!?]+[」』）)】〕〉》”’"']*|[^。！？!?]+$/g;

export function splitSentences(text: string): string[] {
  return (text.match(SENTENCE) ?? []).map((s) => s.trim()).filter(Boolean);
}
