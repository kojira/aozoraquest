/**
 * 投稿 1 件の埋め込みベクトルから、8 認知機能への傾きを計算する。
 * 診断 (runDiagnosis) と同じ Ruri-v3 プロトタイプを再利用するが、ここでは
 * 単一ポストのスコアを返すだけ (正規化も行う)。
 */

import type { CogFunction, CognitiveScores } from '@aozoraquest/core';
import { topNAverage, normalizeCognitive } from '@aozoraquest/core';
import { loadPrototypeEmbeddings, type PrototypeEmbedder } from './prototype-loader';

const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

/**
 * 投稿ベクトルを 8 認知機能の正規化スコア (0-100) に変換する。
 * @param vec embed 済みベクトル
 * @param embedder プロトタイプが bin に無いときのフォールバック用
 */
export async function classifyCognitiveFromVec(
  vec: Float32Array,
  embedder: PrototypeEmbedder,
): Promise<CognitiveScores> {
  const protos = await loadPrototypeEmbeddings(embedder);
  const raw = {} as CognitiveScores;
  for (const fn of COGNITIVE_FUNCTIONS) {
    raw[fn] = topNAverage(vec, protos[fn], 3);
  }
  return normalizeCognitive(raw);
}
