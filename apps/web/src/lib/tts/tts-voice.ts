import type { NpcDef } from '@aozoraquest/core';
export type TtsVoiceId = 'bluesky';
export type TtsEmotion = Partial<Record<'neutral' | 'happy' | 'sad' | 'angry' | 'apologetic', number>>;
export function npcVoice(_npc: Pick<NpcDef, 'spritePreset'>): TtsVoiceId | undefined { return undefined; }
export function lineSpeechText(_text: string): string | null { return null; }
export function lineEmotion(_text: string, _expression?: string): TtsEmotion { return {}; }
