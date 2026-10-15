import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadWeights } from './weights';

/** model.aqw と同じレイアウト (magic, header 長, JSON header, tensor 本体) を組み立てる。 */
function buildAqw(tensors: { name: string; data: Uint8Array }[]): Uint8Array {
  let offset = 0;
  const entries = tensors.map((t) => {
    const e = { name: t.name, dtype: 'f32', shape: [t.data.length / 4], offset, bytes: t.data.length };
    offset += t.data.length;
    return e;
  });
  let json = JSON.stringify({ format: 'aqw1', config: { labels: [], vocab: 0 }, tensors: entries });
  json += ' '.repeat((4 - (json.length % 4)) % 4);
  const header = new TextEncoder().encode(json);
  const out = new Uint8Array(8 + header.length + offset);
  out.set(new TextEncoder().encode('AQW1'), 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let p = 8 + header.length;
  for (const t of tensors) { out.set(t.data, p); p += t.data.length; }
  return out;
}

/** writeBuffer の結果を buffer ごとに組み立て直す偽 GPUDevice。 */
function fakeDevice() {
  const contents = new Map<string, Uint8Array>();
  const destroyed: string[] = [];
  const device = {
    createBuffer: ({ label, size }: { label: string; size: number }) => {
      contents.set(label, new Uint8Array(size));
      return { label, destroy: () => destroyed.push(label) };
    },
    queue: {
      writeBuffer: (buf: { label: string }, offset: number, data: Uint8Array, dataOffset: number, size: number) => {
        if (offset % 4 || size % 4) throw new Error('writeBuffer must be 4-byte aligned');
        contents.get(buf.label)!.set(data.subarray(dataOffset, dataOffset + size), offset);
      },
    },
  };
  return { device: device as unknown as GPUDevice, contents, destroyed };
}

function streamOf(bytes: Uint8Array, chunkSizes: number[]): Response {
  let pos = 0;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (pos >= bytes.length) { ctrl.close(); return; }
      const n = chunkSizes[i++ % chunkSizes.length]!;
      ctrl.enqueue(bytes.slice(pos, pos + n));
      pos += n;
    },
  });
  return new Response(body);
}

const seq = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);

afterEach(() => vi.unstubAllGlobals());

describe('loadWeights', () => {
  test('4 byte 境界に揃わない chunk 分割でも各 tensor の中身が一致する', async () => {
    const tensors = [{ name: 'a', data: seq(12, 1) }, { name: 'b', data: seq(40, 2) }, { name: 'c', data: seq(8, 3) }];
    const file = buildAqw(tensors);
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', async () => streamOf(file, [3, 7, 1, 13, 5]));
    const { device, contents } = fakeDevice();
    const progress: [number, number][] = [];
    const { weights } = await loadWeights(device, 'https://example.test/model.aqw', (l, t) => progress.push([l, t]));
    expect([...weights.keys()]).toEqual(['a', 'b', 'c']);
    for (const t of tensors) expect(Array.from(contents.get(`cognitive:${t.name}`)!)).toEqual(Array.from(t.data));
    // 進捗は tensor 本体の byte 数 (header を除く) で報告する
    expect(progress.at(-1)).toEqual([60, 60]);
  });

  test('途中で切れたファイルは作った buffer を destroy して throw', async () => {
    const file = buildAqw([{ name: 'a', data: seq(16, 1) }, { name: 'b', data: seq(16, 2) }]);
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('fetch', async () => streamOf(file.slice(0, file.length - 8), [64]));
    const { device, destroyed } = fakeDevice();
    await expect(loadWeights(device, 'https://example.test/model.aqw')).rejects.toThrow(/truncated/);
    expect(destroyed.sort()).toEqual(['cognitive:a', 'cognitive:b']);
  });
});
