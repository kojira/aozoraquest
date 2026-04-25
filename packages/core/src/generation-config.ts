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
 * - Desktop: TinySwallow 1.5B q4f16 (WebGPU)
 * - Mobile: LLM 機能 OFF (実機 iPhone Air で全モデル / 全 backend で OOM が
 *   再現できなかったため、PC 限定機能として倒した)
 *   → MOBILE_GENERATION_SPEC は呼ばれない想定だが、import 互換のため定義は残す
 *
 * 検証メモ (実機 iPhone Air iOS 26.4):
 *   - TinySwallow 1.5B WebGPU → init OOM
 *   - Bonsai 1.7B q1 WebGPU   → init OOM
 *   - SmolLM2-360M WebGPU     → init OOM
 *   - SmolLM2-135M WebGPU     → init OK / 推論時 OOM
 *   - SmolLM2-135M WASM       → 動くが英語中心で出力崩壊
 *   - TinySwallow 1.5B WASM   → DL 中 92% で OOM (Cache Storage 圧迫)
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
  /** WebGPU を試さず最初から WASM で動かす。
   *  iOS Safari は WebGPU pipeline は構築できても inference 時に GPU メモリ
   *  確保で OOM クラッシュするケースがあるため、安定性優先のモバイルは WASM 直行。 */
  preferWasm?: boolean;
}

export const DESKTOP_GENERATION_SPEC: GenerationModelSpec = {
  modelId: GENERATION_MODEL_ID,
  webgpuDtype: 'q4f16',
  wasmDtype: 'q4',
  allowWasm: true,
};

export const MOBILE_GENERATION_SPEC: GenerationModelSpec = {
  modelId: GENERATION_MODEL_ID, // TinySwallow 1.5B (Desktop と同じ)
  webgpuDtype: 'q4f16',         // (preferWasm=true なので未使用)
  wasmDtype: 'q4',              // ~600MB on disk
  allowWasm: true,
  preferWasm: true,
};

/** 1 回の生成で出す最大トークン数。精霊は短く返すので抑えめ。 */
export const GENERATION_MAX_NEW_TOKENS = 200;

/** サンプリング温度。 */
export const GENERATION_TEMPERATURE = 0.8;

/** 反復抑制。TinySwallow の再出力対策。 */
export const GENERATION_REPETITION_PENALTY = 1.1;
