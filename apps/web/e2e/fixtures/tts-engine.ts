// Production wrapper (tts-client → tts.worker → ZEN-TTS) on real Blueskyちゃん lines (D-TTS-001). No game state.
import { ttsClient } from '../../src/lib/tts/tts-client';
import { lineEmotion, lineSpeechText } from '../../src/lib/tts/tts-voice';

declare global { interface Window { ttsRun: (lines: string[]) => Promise<unknown> } }
window.ttsRun = async (lines) => {
  const progress: number[] = [];
  const t0 = performance.now();
  await ttsClient.install((loaded, total) => progress.push(loaded / total));
  const loadMs = performance.now() - t0;
  const out = [];
  for (const raw of lines) {
    const text = lineSpeechText(raw)!;
    const emotion = lineEmotion(text);
    const s = performance.now();
    const a = await ttsClient.speak(text, emotion);
    out.push({ text, emotion, sampleRate: a.sampleRate, ms: performance.now() - s, pcm: Array.from(a.pcm) });
  }
  const keys = await (await caches.open('tts-v1')).keys();
  return { loadMs, lastProgress: progress.at(-1), progressCount: progress.length, cached: keys.map((k) => k.url), out, cacheNames: await caches.keys() };
};
document.getElementById('out')!.textContent = 'ready';
