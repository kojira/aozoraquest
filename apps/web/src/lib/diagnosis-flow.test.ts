/**
 * 事前計算 .bin → unpack → Float32Array[] のラウンドトリップを検証。
 * fetch をモックして 8 認知機能分を供給する。
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '@aozoraquest/core';
import { loadPrototypeEmbeddings, unpackBin } from './prototype-loader';

const COG = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

function packBin(vectors: Float32Array[], dims: number): ArrayBuffer {
  const n = vectors.length;
  const buf = new ArrayBuffer(8 + n * dims * 4);
  const view = new DataView(buf);
  view.setInt32(0, n, true);
  view.setInt32(4, dims, true);
  let off = 8;
  for (const v of vectors) {
    for (let i = 0; i < dims; i++) {
      view.setFloat32(off, v[i]!, true);
      off += 4;
    }
  }
  return buf;
}

describe('unpackBin', () => {
  test('pack → unpack で値が一致する', () => {
    const v1 = new Float32Array(EMBEDDING_DIMENSIONS);
    const v2 = new Float32Array(EMBEDDING_DIMENSIONS);
    for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
      v1[i] = Math.sin(i);
      v2[i] = Math.cos(i);
    }
    const packed = packBin([v1, v2], EMBEDDING_DIMENSIONS);
    const unpacked = unpackBin(packed);
    expect(unpacked).toHaveLength(2);
    expect(Array.from(unpacked[0]!)).toEqual(Array.from(v1));
    expect(Array.from(unpacked[1]!)).toEqual(Array.from(v2));
  });

  test('次元不一致はエラー', () => {
    const bad = packBin([new Float32Array(64)], 64);
    expect(() => unpackBin(bad)).toThrow(/dim/);
  });
});

describe('loadPrototypeEmbeddings', () => {
  afterEach(() => vi.restoreAllMocks());

  test('全ての .bin が揃えば embedder なしで読める', async () => {
    const dummyVec = (seed: number) => {
      const v = new Float32Array(EMBEDDING_DIMENSIONS);
      for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) v[i] = Math.sin(seed + i * 0.01);
      return v;
    };
    const bins = new Map<string, ArrayBuffer>();
    COG.forEach((fn, idx) => {
      bins.set(`/prototypes/cognitive/${fn}.bin`, packBin([dummyVec(idx), dummyVec(idx + 10)], EMBEDDING_DIMENSIONS));
    });

    vi.stubGlobal('fetch', async (url: string) => {
      const rel = url.replace(/^https?:\/\/[^/]+/, '');
      const match = bins.get(rel);
      if (match) return new Response(match, { status: 200 });
      return new Response('', { status: 404 });
    });

    const result = await loadPrototypeEmbeddings(null);
    for (const fn of COG) {
      const vecs = (result as Record<string, Float32Array[]>)[fn];
      expect(vecs).toHaveLength(2);
      expect(vecs?.[0]?.length).toBe(EMBEDDING_DIMENSIONS);
    }
  });

  test('.bin が 1 つでも欠けて embedder が null の場合はエラー', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(loadPrototypeEmbeddings(null)).rejects.toThrow(/\.bin missing/);
  });

  test('.bin が欠けていて embedder があれば JSON で fallback', async () => {
    const embedder = {
      embedBatch: vi.fn(async (texts: string[]) =>
        texts.map((_, i) => {
          const v = new Float32Array(EMBEDDING_DIMENSIONS);
          v[0] = i;
          return v;
        }),
      ),
    };

    const jsonFor = (fn: string) => ({
      function: fn,
      prototypes: [{ text: `${fn}-1` }, { text: `${fn}-2` }],
    });
    vi.stubGlobal('fetch', async (url: string) => {
      const rel = url.replace(/^https?:\/\/[^/]+/, '');
      if (rel.endsWith('.bin')) return new Response('', { status: 404 });
      const m = /\/prototypes\/cognitive\/(\w+)\.json$/.exec(rel);
      if (m) return new Response(JSON.stringify(jsonFor(m[1]!)), { status: 200 });
      return new Response('', { status: 404 });
    });

    const result = await loadPrototypeEmbeddings(embedder);
    expect(embedder.embedBatch).toHaveBeenCalledTimes(COG.length);
    for (const fn of COG) {
      expect((result as Record<string, Float32Array[]>)[fn]).toHaveLength(2);
    }
  });
});
