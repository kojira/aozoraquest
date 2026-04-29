/**
 * 投稿テキストごとの cognitive function 判定 (Fe/Ni 等のスコア)。
 *
 * `getAnalyzePosts()` が ON の時のみ TL の各投稿で auto 起動。
 * 推論は ONNX classifier 経由 (URL/hashtag/mention 除去 → 文分割 → 平均) で、
 * `cognitive-onnx.ts:classifyPost` を呼ぶだけ (前処理は向こうで完結)。
 *
 * 結果はメモリキャッシュ (Map<uri, scores>) のみ。同じ post を別の場所で
 * 再描画しても 1 度しか推論しない。タブ閉じたら破棄でよい (PDS に書かない)。
 *
 * モバイル (low-end) はモデルロードで OOM するので強制 OFF。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CognitiveScores } from '@aozoraquest/core';
import { getCognitiveOnnxClassifier } from './cognitive-onnx';
import { hasJapanese, preprocessText } from './japanese-text';
import { getAnalyzePosts } from './prefs';
import { isLowEndDevice } from './device';

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
      try {
        const s = await getCognitiveOnnxClassifier().classifyPost(text);
        cache.set(uri, s);
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
