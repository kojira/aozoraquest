/**
 * Blueskyちゃんの声の ON/OFF (D-TTS-001)。端末ごと (localStorage)、既定は OFF。
 * 会話窓と設定のトグルが同じ状態を見る (useSyncExternalStore)。
 * ON にするとき: タップの中で音声を解錠 (iOS) → 声のファイルを取得 (初回 約41MB、進捗) → 読み込めたら ON。
 */
import { useSyncExternalStore } from 'react';
import { ttsClient } from './tts-client';
import { voicePlayer } from './voice-player';

const KEY = 'aozoraquest:voice';

export interface VoiceState { enabled: boolean; installing: { loaded: number; total: number } | null; error: string | null }

function stored(): boolean {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}
function store(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* no-op */ }
}

let state: VoiceState = { enabled: stored(), installing: null, error: null };
const listeners = new Set<() => void>();
function set(next: Partial<VoiceState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function getVoiceState(): VoiceState { return state; }
export function subscribeVoice(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useVoiceState(): VoiceState {
  return useSyncExternalStore(subscribeVoice, getVoiceState, getVoiceState);
}

/** トグルのタップから呼ぶ (同期の部分で音声を解錠するため、await の前に unlock する)。 */
export function toggleVoice(): void {
  if (state.installing) return;
  if (state.enabled) {
    voicePlayer.stop();
    store(false);
    set({ enabled: false });
    return;
  }
  voicePlayer.unlock();
  set({ installing: { loaded: 0, total: 0 }, error: null });
  ttsClient.install((loaded, total) => set({ installing: { loaded, total } })).then(() => {
    store(true);
    set({ enabled: true, installing: null });
  }, (e: unknown) => {
    console.warn('[tts] install failed', e);
    set({ installing: null, error: '声を読み込めませんでした。通信や端末の空きを確かめて、もう一度お試しください。' });
  });
}

/** 導入済みのはずのキャッシュが消えていた等で読めないときは OFF に戻す (次に ON で取り直す)。 */
export function disableVoice(reason: string): void {
  store(false);
  set({ enabled: false, error: reason });
}

export function resetVoiceForTest(): void {
  state = { enabled: stored(), installing: null, error: null };
}
