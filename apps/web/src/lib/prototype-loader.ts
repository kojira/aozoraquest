/**
 * 認知機能プロトタイプ埋め込みのローダー。
 *
 * - 事前計算 (scripts/build-prototypes.ts) で作った .bin をまず試す
 * - 見つからなければ JSON を読んでランタイムで embedder に計算させる
 *
 * bin レイアウト:
 *   int32 LE N   : プロトタイプ数
 *   int32 LE D   : 次元数
 *   float32[N*D] : ベクトル本体 (little-endian)
 */

import { EMBEDDING_DIMENSIONS, type CogFunction } from '@aozoraquest/core';

const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

interface PrototypeJson {
  function?: string;
  prototypes: Array<{ text: string }>;
}

export interface PrototypeEmbedder {
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}

export function unpackBin(buf: ArrayBuffer): Float32Array[] {
  const view = new DataView(buf);
  const n = view.getInt32(0, true);
  const d = view.getInt32(4, true);
  if (d !== EMBEDDING_DIMENSIONS) {
    throw new Error(`prototype .bin dim ${d} != EMBEDDING_DIMENSIONS ${EMBEDDING_DIMENSIONS}`);
  }
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const view32 = new Float32Array(buf, 8 + i * d * 4, d);
    // 元の buffer が GC されないようにコピーを返す
    vecs.push(new Float32Array(view32));
  }
  return vecs;
}

export async function loadPrototypeEmbeddings(
  embedder: PrototypeEmbedder | null,
): Promise<Record<CogFunction, Float32Array[]>> {
  const result = {} as Record<CogFunction, Float32Array[]>;

  // 1) 事前計算 bin を並列取得
  const binResults = await Promise.all(
    COGNITIVE_FUNCTIONS.map(async (fn) => {
      try {
        const res = await fetch(`/prototypes/cognitive/${fn}.bin`);
        if (!res.ok) return null;
        return unpackBin(await res.arrayBuffer());
      } catch {
        return null;
      }
    }),
  );
  if (binResults.every((v) => v !== null)) {
    COGNITIVE_FUNCTIONS.forEach((fn, i) => {
      result[fn] = binResults[i]!;
    });
    return result;
  }

  // 2) フォールバック: JSON + ランタイム埋め込み
  if (!embedder) throw new Error('prototype .bin missing and no embedder provided for fallback');
  console.info('prototype .bin not found; embedding from JSON at runtime');
  for (const fn of COGNITIVE_FUNCTIONS) {
    const res = await fetch(`/prototypes/cognitive/${fn}.json`);
    if (!res.ok) throw new Error(`failed to load prototype ${fn}: ${res.status}`);
    const json = (await res.json()) as PrototypeJson;
    const texts = json.prototypes.map((p) => p.text);
    result[fn] = await embedder.embedBatch(texts);
  }
  return result;
}
