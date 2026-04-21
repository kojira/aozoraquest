/**
 * ブラウザ内 LLM (テキスト生成) の設定。
 *
 * docs/data/llm-benchmark-browser-gen.md の結論:
 *   TinySwallow-1.5B-Instruct q4f16 が最も実用的。WebGPU 必須。
 *   ロード初回 ~1.8GB、WASM フォールバックは遅すぎるので用意しない。
 */

export const GENERATION_MODEL_ID = 'onnx-community/TinySwallow-1.5B-Instruct-ONNX' as const;

/** 量子化種別。Transformers.js v4 の pipeline に渡す。 */
export const GENERATION_DTYPE = 'q4f16' as const;

/** 実行デバイス。WebGPU 必須。 */
export const GENERATION_DEVICE = 'webgpu' as const;

/** 1 回の生成で出す最大トークン数。精霊は短く返すので抑えめ。 */
export const GENERATION_MAX_NEW_TOKENS = 200;

/** サンプリング温度。 */
export const GENERATION_TEMPERATURE = 0.8;

/** 反復抑制。TinySwallow の再出力対策。 */
export const GENERATION_REPETITION_PENALTY = 1.1;
