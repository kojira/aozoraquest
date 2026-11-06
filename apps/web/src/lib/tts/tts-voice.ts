/**
 * Blueskyちゃんの声 (D-TTS-001): だれの行を、どの文で、どの感情で読むか (純関数)。
 *
 * - 声を出す相手はデータで決める: NPC の見た目プリセット `spritePreset: 'bluesky'` (「Blueskyちゃん」の絵)。
 *   名前 ({c:bluesky}) は改名・町名つきで変わるので見ない。
 * - 読む文は会話窓に出す文 (タグは外し、{c:id} は窓で解決済み) から、全角括弧のト書きを除いたもの。
 * - 感情は文から決める決定的な規則 (上から最初に当たったもの)。
 */
import type { NpcDef } from '@aozoraquest/core';

export type TtsVoiceId = 'bluesky';
export type TtsEmotion = Partial<Record<'neutral' | 'happy' | 'sad' | 'angry' | 'apologetic', number>>;
/** 会話窓の 1 行に付ける「この行は声で読む」印。expression は台詞先頭の表情タグ ([sad] など)。 */
export interface DialogueVoiceCue { voice: TtsVoiceId; expression?: string }

export function npcVoice(npc: Pick<NpcDef, 'spritePreset'>): TtsVoiceId | undefined {
  return npc.spritePreset === 'bluesky' ? 'bluesky' : undefined;
}

/** 読む文。全角括弧 （…） はト書き (「（小さな声で）」) なので読まない。読む字が残らなければ null。 */
export function lineSpeechText(text: string): string | null {
  const spoken = text.replace(/（[^）]*）/g, '').trim();
  return /[\p{L}\p{N}]/u.test(spoken) ? spoken : null;
}

const APOLOGY = /ごめん|すまない|すみません|申し訳/;
const SAD = /かなし|悲し|さみし|さびし|寂し|つらい|辛い|いなくな|泣/;
const HAPPY = /[！!]|うれし|嬉し|よかった|ありがと|たのし|楽し/;

export function lineEmotion(text: string, expression?: string): TtsEmotion {
  if (APOLOGY.test(text)) return { apologetic: 70, neutral: 30 };
  if (SAD.test(text) || expression === 'sad') return { sad: 70, neutral: 30 };
  if (HAPPY.test(text)) return { happy: 70, neutral: 30 };
  return { neutral: 100 };
}
