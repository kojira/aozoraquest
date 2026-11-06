import { describe, expect, test, vi } from 'vitest';
import { cachedAssetFetch } from './tts-fetch';

// D-TTS-001: ZEN-TTS fetches its files by URL; inside our worker those URLs are answered from the
// verified tts-v1 copies (no second download, ZEN-TTS itself unchanged). Other URLs go to the network.
describe('cachedAssetFetch', () => {
  test('answers the known files (relative or absolute) from memory and passes others through', async () => {
    const net = vi.fn(async () => new Response('net'));
    const files = new Map([['https://app.test/zen-tts/1.2.0/models/g2p/g2p.json', new TextEncoder().encode('{"a":1}').buffer as ArrayBuffer]]);
    const f = cachedAssetFetch(files, 'https://app.test/world', net as unknown as typeof fetch);
    expect(await (await f('/zen-tts/1.2.0/models/g2p/g2p.json')).json()).toEqual({ a: 1 });
    expect(await (await f('https://app.test/zen-tts/1.2.0/models/g2p/g2p.json')).text()).toBe('{"a":1}');
    expect(net).not.toHaveBeenCalled();
    expect(await (await f('https://other.test/x')).text()).toBe('net');
    expect(net).toHaveBeenCalledTimes(1);
  });
});
