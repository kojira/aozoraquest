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

/**
 * 端末別 LLM スペック。
 * - Desktop: TinySwallow 1.5B q4f16 (日本語強い、~600MB)
 * - Mobile: SmolLM2-360M-Instruct q4f16 (英語中心、~273MB)
 *
 * Bonsai 1.7B q1 (~290MB on disk) も検討したが、メモリ展開時に
 * iPhone Air / Pixel 7a/9 で OOM クラッシュした (1-bit 重みを
 * 推論時に dequant するためメモリ使用量が膨らむのが原因と推定)。
 * SmolLM2-360M は素直に小さいので両 backend で安全に乗る想定。
 */
/** Transformers.js が受け付ける dtype のリテラル和。 */
export type GenerationDtype =
  | 'auto' | 'fp32' | 'fp16' | 'q4f16' | 'q4' | 'q8' | 'int8' | 'uint8'
  | 'bnb4' | 'q2' | 'q2f16' | 'q1' | 'q1f16';

export interface GenerationModelSpec {
  modelId: string;
  webgpuDtype: GenerationDtype;
  wasmDtype: GenerationDtype;
  /** WASM fallback を許可するか。極小モデルは true、特殊量子化前提モデルは false */
  allowWasm: boolean;
}

export const DESKTOP_GENERATION_SPEC: GenerationModelSpec = {
  modelId: GENERATION_MODEL_ID,
  webgpuDtype: 'q4f16',
  wasmDtype: 'q4',
  allowWasm: true,
};

export const MOBILE_GENERATION_SPEC: GenerationModelSpec = {
  modelId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
  webgpuDtype: 'q4f16', // 273 MB
  wasmDtype: 'q4',      // 388 MB
  allowWasm: true,
};

/** 1 回の生成で出す最大トークン数。精霊は短く返すので抑えめ。 */
export const GENERATION_MAX_NEW_TOKENS = 200;

/** サンプリング温度。 */
export const GENERATION_TEMPERATURE = 0.8;

/** 反復抑制。TinySwallow の再出力対策。 */
export const GENERATION_REPETITION_PENALTY = 1.1;
