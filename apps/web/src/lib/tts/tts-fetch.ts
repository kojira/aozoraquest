/**
 * ZEN-TTS は G2P・CPU カーネル・声を URL で fetch する。tts.worker の中だけ、その URL を
 * tts-v1 で照合済みの写し (メモリ) で答える (二重のダウンロードをせず、ZEN-TTS のコードは変えない)。
 */
export function cachedAssetFetch(files: ReadonlyMap<string, ArrayBuffer>, base: string, net: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const buf = files.get(new URL(raw, base).href);
    return buf ? Promise.resolve(new Response(buf.slice(0))) : net(input, init);
  }) as typeof fetch;
}
