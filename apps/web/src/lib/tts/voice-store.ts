export interface VoiceState { enabled: boolean; installing: { loaded: number; total: number } | null; error: string | null }
export function getVoiceState(): VoiceState { return { enabled: false, installing: null, error: null }; }
export function subscribeVoice(_l: () => void): () => void { return () => {}; }
export function useVoiceState(): VoiceState { return getVoiceState(); }
export function toggleVoice(): void {}
export function resetVoiceForTest(): void {}
