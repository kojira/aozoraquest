/**
 * あおぞらワールドの音の設定 (D-SOUND-001)。端末ごと (localStorage)。
 * - BGM・効果音: はじめから ON。設定画面で別々に OFF にできる (`'on'`/`'off'`)。
 * - ミュート: ワールドの 🔊/🔇 ボタン。ゲームの音 (BGM・効果音・Blueskyちゃんの声) をぜんぶ止める親スイッチ。
 *   声の ON/OFF (voice-store) は変えない。
 * 形は voice-store と同じ (useSyncExternalStore)。
 */
import { useSyncExternalStore } from 'react';

export const SOUND_KEYS = { bgm: 'aozoraquest:bgm', se: 'aozoraquest:se', muted: 'aozoraquest:mute' } as const;

export interface SoundSettings { bgm: boolean; se: boolean; muted: boolean }

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* no-op */ }
}
function stored(): SoundSettings {
  return { bgm: read(SOUND_KEYS.bgm) !== 'off', se: read(SOUND_KEYS.se) !== 'off', muted: read(SOUND_KEYS.muted) === 'on' };
}

let settings: SoundSettings = stored();
const listeners = new Set<() => void>();

export function getSoundSettings(): SoundSettings { return settings; }
export function subscribeSoundSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(subscribeSoundSettings, getSoundSettings, getSoundSettings);
}

export function setSoundSetting(kind: keyof SoundSettings, on: boolean): void {
  if (settings[kind] === on) return;
  write(SOUND_KEYS[kind], on);
  settings = { ...settings, [kind]: on };
  for (const l of listeners) l();
}

export function resetSoundSettingsForTest(): void {
  settings = stored();
}
