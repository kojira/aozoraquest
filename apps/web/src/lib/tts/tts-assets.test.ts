import { describe, expect, test } from 'vitest';
import { TTS_ASSETS, TTS_CACHE_NAME, TTS_TOTAL_BYTES, TTS_ZTM_URL } from './tts-assets';

describe('tts assets', () => {
  test('the voice is pinned to the HF commit; G2P and the CPU kernel come from our own origin', () => {
    expect(TTS_CACHE_NAME).toBe('tts-v1');
    expect(TTS_ZTM_URL).toBe('https://huggingface.co/kojira/aozoraquest-cognitive-small/resolve/d00b061951e41cdeb35f9d072fd3b0241e9703f5/tts/bluesky-1.1.0/bluesky.ztm');
    expect(TTS_ASSETS.find((a) => a.url === TTS_ZTM_URL)?.sha256).toBe('fccfa172ab5d687e617d62cbb7154d36ef2bc0394cba97ef4bb2abec7c92df93');
    for (const a of TTS_ASSETS.filter((x) => x.url !== TTS_ZTM_URL)) expect(a.url.startsWith('/zen-tts/1.2.0/')).toBe(true);
    // Each file served from the app's origin stays under Cloudflare's 25 MiB per-file limit.
    for (const a of TTS_ASSETS) if (a.url.startsWith('/')) expect(a.bytes).toBeLessThan(25 * 1024 * 1024);
    expect(TTS_TOTAL_BYTES).toBe(27_650_016 + 13_453_312 + 55_408 + 61_165);
  });
});
