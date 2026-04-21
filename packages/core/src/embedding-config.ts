/**
 * Browser LLM (埋め込みモデル) の設定。
 *
 * 11-validation.md §実験 1 の結果で確定:
 *   sirasagi62/ruri-v3-30m-ONNX (int8, ~37MB, 256次元)
 *
 * 採用の根拠 (docs/data/llm-benchmark.md):
 *   MiniLM q8 vs Ruri-v3-30m int8: 認知 Top-1 70% → 82.5% (+12.5pt)、
 *   タグ Top-1 68.9% → 73.3% (+4.4pt)、サイズ 120MB → 37MB (1/3)。
 *   日本語ネイティブ (ModernBERT-ja + Ruri-v3 finetune、JMTEB STS 82.48)。
 *
 * 閾値 (タグ分類でバッジ判定等の閾値処理をする場合) は 0.85 推奨。
 * Ruri の類似度分布は全体的に高めなので、0.7 では中立投稿も全部該当する
 * (docs/data/llm-benchmark-minilm-sweep.md 参照)。
 *
 * モデルを差し替える場合:
 *   1. この定数を更新
 *   2. packages/prompts/cognitive/*.json の事前埋め込みを再生成
 *      (次元が変わるので cached .bin ファイルも再生成)
 *   3. scripts/validate-llm.ts で合格基準を再検証
 *   4. docs/data/llm-benchmark.md を上書き
 */

export const EMBEDDING_MODEL_ID = 'sirasagi62/ruri-v3-30m-ONNX' as const;

/** ベクトル次元数。モデルと合わせること。 */
export const EMBEDDING_DIMENSIONS = 256;

/** 量子化種別。Transformers.js の dtype パラメータに渡す。 */
export const EMBEDDING_DTYPE = 'int8' as const;

/**
 * タグ分類の閾値。コサイン類似度がこれ未満なら「無分類」扱い。
 * Ruri-v3-30m の分布を踏まえた運用値。
 * 中立投稿 FP ≈ 9%、タグラベル通過率 ≈ 23% の操作点。
 */
export const TAG_CLASSIFICATION_THRESHOLD = 0.85;

/** 診断時の Top-N 平均 (04-diagnosis.md)。 */
export const DIAGNOSIS_TOP_N = 3;

/** e5 系モデルは passage: prefix が必要。Ruri は不要。 */
export const EMBEDDING_NEEDS_E5_PREFIX = false;
