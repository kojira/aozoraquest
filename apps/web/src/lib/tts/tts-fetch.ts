export function cachedAssetFetch(_files: ReadonlyMap<string, ArrayBuffer>, _base: string, net: typeof fetch): typeof fetch { return net; }
