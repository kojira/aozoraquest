/**
 * ブルスコン (LFM2.5) 用の翻訳プロンプトと後処理 (Gemini Nano のプロンプトは translate.ts のまま変えない)。
 *
 * 品質確認 (D-SLM-CARD-001 §1) の採用案: system 1 行 + 本文だけ。few-shot は例文の内容が訳文に混じるので使わない。
 * 生成は最初の改行で止まる (slm-llm.ts)。複数段落は translate.ts が段落ごとに呼ぶ。
 */
import type { LLMInput } from './local-llm';

export const SLM_TRANSLATE_SYSTEM =
  '英語の SNS 投稿を日本語に訳す。友達に話すくだけた口調 (〜だよ、〜した) にし、です・ます調は使わない。訳文だけを 1 行で出す。原文に無いことは足さない。説明・注釈・引用符は書かない。';

/** 1 段落ぶんの翻訳入力。 */
export function slmTranslateInput(paragraph: string): LLMInput {
  return { systemPrompt: SLM_TRANSLATE_SYSTEM, history: [{ role: 'user', content: paragraph }] };
}

/** 出力上限: 英語 1 token ≒ 4 文字、訳は原文の 2 倍まで、最大 200。 */
export function paragraphMaxNewTokens(paragraph: string): number {
  return Math.min(200, Math.ceil(paragraph.length / 2) + 16);
}

/** 空行で段落に分ける (段落内の改行は既存経路と同じく空白にまとめる)。 */
export function splitParagraphs(body: string): string[] {
  return body.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
}

/** 1 段落の出力を整える: 最初の改行までだけ使い、全体を囲む引用符を消す。cleanTranslation などは呼び出し側で既存どおり掛ける。 */
export function cleanSlmParagraph(raw: string): string {
  const t = (raw.split('\n')[0] ?? '').trim().replace(/^["“「『](.*)["”」』]$/u, '$1');
  return t.replace(/\s{2,}/g, ' ').trim();
}
