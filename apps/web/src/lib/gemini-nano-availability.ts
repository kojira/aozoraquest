/**
 * Chrome built-in AI (Gemini Nano / Prompt API) の利用可能性検出。
 *
 * 戻り値:
 *  - 'available'    : すぐ使える
 *  - 'downloadable' : 端末は対応するが、モデル未 DL (今回は使わず TinySwallow に fallback)
 *  - 'downloading'  : ユーザーが他サイトで DL を開始済みの途中
 *  - 'unavailable'  : 環境非対応 (Firefox/Safari/Android/古い Chrome 等)
 */

export type NanoStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';

let cached: NanoStatus | null = null;

export async function detectGeminiNano(force = false): Promise<NanoStatus> {
  if (!force && cached) return cached;
  if (typeof LanguageModel === 'undefined') {
    cached = 'unavailable';
    return cached;
  }
  try {
    const a = await LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['ja', 'en'] }],
      expectedOutputs: [{ type: 'text', languages: ['ja'] }],
    });
    cached = a;
    return a;
  } catch {
    cached = 'unavailable';
    return cached;
  }
}

export function getCachedNanoStatus(): NanoStatus | null {
  return cached;
}
