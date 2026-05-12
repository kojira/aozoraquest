/**
 * 翻訳用の Gemini Nano 薄いラッパー。
 *
 * `gemini-nano-backend.ts` の generateWithGeminiNano を再利用するだけ。
 * Bluskon (spirit) と違って:
 *  - トグル / 端末別 pref は持たない (Nano available なら常に試す)
 *  - 失敗時の挙動は呼び元の translate.ts が決める (retry chain で TinySwallow にフォールスルー)
 *
 * Google 公式は「Nano は英語以外の翻訳に弱い」と明記しており、品質は
 * TinySwallow より劣る可能性がある。validate (looksLikeJapaneseTranslation)
 * で日本語比率を見て NG なら次の attempt に進むので、品質 NG の自己回復が効く。
 */

import { detectGeminiNano } from './gemini-nano-availability';
import { generateWithGeminiNano } from './gemini-nano-backend';

export async function isNanoAvailableForTranslate(): Promise<boolean> {
  return (await detectGeminiNano()) === 'available';
}

export async function translateWithNano(
  systemPrompt: string,
  userPrompt: string,
  temperature: number,
): Promise<string> {
  return generateWithGeminiNano(
    { systemPrompt, history: [{ role: 'user', content: userPrompt }] },
    { temperature, maxNewTokens: 200 },
  );
}
