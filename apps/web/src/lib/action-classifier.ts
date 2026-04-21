/**
 * 投稿本文から行動タイプを分類する。
 *
 * - apps/web/public/prototypes/actions/*.bin を読み込み (Ruri-v3 で事前埋め込み済み)
 * - 投稿テキストを Embedder で埋め込み
 * - 各アクションプロトタイプ群とのコサイン類似度 (Top-N 平均) を比較
 * - 最大スコアのアクションを返す。"neutral" が最大ならアクション無し扱い。
 */

import { unpackBin } from './prototype-loader';
import { Embedder } from './embedder';

export type ActionCategory =
  | 'opinion_post'
  | 'analysis_post'
  | 'short_burst'
  | 'humor_post'
  | 'empathy_reply'
  | 'neutral';

const CATEGORIES: ActionCategory[] = [
  'opinion_post',
  'analysis_post',
  'short_burst',
  'humor_post',
  'empathy_reply',
  'neutral',
];

export interface ActionClassifierResult {
  action: ActionCategory | null; // neutral もしくは未確定なら null
  scores: Record<ActionCategory, number>;
  /** 2 位との差 (確度)。小さいほど曖昧。 */
  margin: number;
}

let prototypes: Record<ActionCategory, Float32Array[]> | null = null;

async function loadPrototypes(): Promise<Record<ActionCategory, Float32Array[]>> {
  if (prototypes) return prototypes;
  const result = {} as Record<ActionCategory, Float32Array[]>;
  const loaded = await Promise.all(
    CATEGORIES.map(async (c) => {
      const res = await fetch(`/prototypes/actions/${c}.bin`);
      if (!res.ok) throw new Error(`action prototype missing: ${c}`);
      return unpackBin(await res.arrayBuffer());
    }),
  );
  CATEGORIES.forEach((c, i) => {
    result[c] = loaded[i]!;
  });
  prototypes = result;
  return result;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

function topNAverage(postVec: Float32Array, protos: Float32Array[], n = 3): number {
  const sims = protos.map((p) => cosineSim(postVec, p));
  sims.sort((a, b) => b - a);
  const take = Math.min(n, sims.length);
  let s = 0;
  for (let i = 0; i < take; i++) s += sims[i]!;
  return s / take;
}

/**
 * 投稿 1 件を分類する。内部で embed を走らせる。
 * 複数用途 (行動 + 認知) に使いたいときは先に embed してから classifyFromVec を呼ぶ。
 */
export async function classifyPost(embedder: Embedder, text: string): Promise<ActionClassifierResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return emptyResult();
  const vec = await embedder.embed(trimmed);
  return classifyFromVec(vec);
}

/** 埋め込み済みベクトルから直接分類 (単一 embed を複数分類で使い回す用) */
export async function classifyFromVec(vec: Float32Array): Promise<ActionClassifierResult> {
  const protos = await loadPrototypes();
  const scores = {} as Record<ActionCategory, number>;
  for (const c of CATEGORIES) {
    scores[c] = topNAverage(vec, protos[c], 3);
  }
  const sorted = CATEGORIES.slice().sort((a, b) => scores[b] - scores[a]);
  const top = sorted[0]!;
  const second = sorted[1]!;
  const margin = scores[top] - scores[second];

  const MIN_MARGIN = 0.02;
  if (margin < MIN_MARGIN) return { action: null, scores, margin };
  if (top === 'neutral') return { action: null, scores, margin };
  return { action: top, scores, margin };
}

function emptyResult(): ActionClassifierResult {
  const zeros = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<ActionCategory, number>;
  return { action: null, scores: zeros, margin: 0 };
}
