/**
 * 投稿テキストごとの cognitive function 判定 (Fe/Ni 等のスコア)。
 *
 * `getAnalyzePosts()` が ON の時のみ TL の各投稿で auto 起動。
 * 推論は ONNX classifier 経由 (URL/hashtag/mention 除去 → 文分割 → 平均) で、
 * `cognitive-onnx.ts:classifyPost` を呼ぶだけ (前処理は向こうで完結)。
 *
 * 2 段キャッシュ:
 * - メモリ Map<uri, scores>: 同タブ内の再描画 dedup
 * - IDB (`cognitive-idb.ts`): リロード後も再推論しない (post 本文は immutable
 *   なので URI = 一意で OK)。TTL 30 日
 *
 * モバイル (low-end) はモデルロードで OOM するので強制 OFF。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CognitiveScores } from '@aozoraquest/core';
import { getCognitiveOnnxClassifier } from './cognitive-onnx';
import { hasJapanese, preprocessText } from './japanese-text';
import { getAnalyzePosts } from './prefs';
import { isLowEndDevice } from './device';
import { loadCachedCognitive, saveCachedCognitive } from './cognitive-idb';

const MIN_TEXT_LEN = 10;

const cache = new Map<string, CognitiveScores | null>();

export type AnalysisState = 'idle' | 'loading' | 'done' | 'error' | 'skipped';

export interface UseCognitiveAnalysisResult {
  state: AnalysisState;
  scores: CognitiveScores | null;
  error: string | undefined;
  /** 自動分析 OFF の時に手動で分析を開始するためのトリガ */
  triggerAnalyze: () => void;
  /** 分析対象 (PC + 日本語比率十分 + 短すぎない) かどうか。UI 表示判定に使う。 */
  canAnalyze: boolean;
}

export function useCognitiveAnalysis(
  uri: string | undefined,
  text: string,
): UseCognitiveAnalysisResult {
  const [state, setState] = useState<AnalysisState>('idle');
  const [scores, setScores] = useState<CognitiveScores | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  const lowEnd = isLowEndDevice();
  const pre = preprocessText(text);
  const canAnalyze = !lowEnd && Boolean(uri) && pre.length >= MIN_TEXT_LEN && hasJapanese(pre);

  const run = useCallback(() => {
    if (!uri || !canAnalyze) return;
    if (startedRef.current) return;
    startedRef.current = true;
    if (cache.has(uri)) {
      const c = cache.get(uri) ?? null;
      setScores(c);
      setState(c ? 'done' : 'skipped');
      return;
    }
    setState('loading');
    setError(undefined);
    (async () => {
      // 1) IDB 確認: リロード後も同じ post なら ONNX 再推論しない
      try {
        const cached = await loadCachedCognitive(uri);
        if (cached) {
          cache.set(uri, cached);
          setScores(cached);
          setState('done');
          return;
        }
      } catch {
        /* IDB 失敗は無視して推論に進む */
      }
      // 2) IDB miss: ONNX 推論
      try {
        const s = await getCognitiveOnnxClassifier().classifyPost(text);
        cache.set(uri, s);
        if (s) void saveCachedCognitive(uri, s);
        setScores(s);
        setState(s ? 'done' : 'skipped');
      } catch (e) {
        console.warn('[cognitive] analyze failed', e);
        setError(String((e as Error)?.message ?? e));
        setState('error');
      }
    })();
  }, [uri, text, canAnalyze]);

  const triggerAnalyze = useCallback(() => run(), [run]);

  useEffect(() => {
    if (!canAnalyze) return;
    if (!getAnalyzePosts()) return;
    run();
  }, [canAnalyze, run]);

  useEffect(() => {
    startedRef.current = false;
    setState('idle');
    setScores(null);
    setError(undefined);
  }, [uri]);

  return { state, scores, error, triggerAnalyze, canAnalyze };
}
