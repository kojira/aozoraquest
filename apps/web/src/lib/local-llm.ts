/**
 * ブラウザ内 LLM の抽象レイヤ。
 *
 * 設計目的: 将来 LLM backend が増えたり差し替わったりしても、各 caller
 * (spirit / translate / flavor-text / summoning-ritual) を触らずに済むこと。
 *
 * 現状は Gemini Nano (Chrome 148+ の LanguageModel API) のみ。将来想定:
 *  - Edge 内蔵 AI / Safari 内蔵 AI (まだ無いが API は web 標準化提案中)
 *  - aozoraquest 自前 API (server fallback、Nano 不可環境向け)
 *  - 別ローカルモデル (transformers.js 製 など)
 *
 * 新しい backend を追加するには:
 *  1. apps/web/src/lib/<name>-llm.ts に LocalLLM を実装したオブジェクトを export
 *  2. このファイルの BACKENDS 配列にその実装を追加 (順序 = 優先順位)
 *
 * caller 側のコード変更は不要。
 */

export interface LLMInput {
  /** 空文字でも可 (admin 未設定時) */
  systemPrompt: string;
  /** 最後の要素は role === 'user' であること (= 今応答してほしい turn) */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface LLMOptions {
  /** 各 chunk が来るたびに呼ばれる streaming callback */
  onToken?: (t: string) => void;
  /** 0=greedy。各 backend の API がサポートしていれば反映。 */
  temperature?: number;
  /** 出力長の soft cap。backend が厳密 token cap を持っていればそれ、
   *  持っていない (Nano など) なら文字数近似で打ち切る。 */
  maxNewTokens?: number;
  signal?: AbortSignal;
}

export interface LocalLLM {
  /** ログ / 比較 / UI 表示用の安定 ID。
   *  例: 'gemini-nano', 'gemini-nano-v2', 'edge-ai', 'aozoraquest-api' */
  readonly id: string;
  /** UI 表示用の人間可読ラベル */
  readonly label: string;
  /** 今このセッションで使えるか。memoize 推奨 (caller が連呼するため)。 */
  availability(): Promise<boolean>;
  /** 1 turn の生成。`history` 最後の user message への応答を返す。
   *  実装側で session の作成・破棄を完結させる (caller は知らなくて良い)。 */
  generate(input: LLMInput, opts?: LLMOptions): Promise<string>;
}

export interface LLMGenResult {
  text: string;
  /** どの backend が応答したか (logs / UI 表示)。`LocalLLM.id` をそのまま入れる。 */
  backend: string;
}

import { GEMINI_NANO } from './gemini-nano-llm';

/** 優先順位順 backend リスト。先頭から availability() を問い合わせ、
 *  最初に true を返したものを採用する。新規 backend はここに追加するだけ。 */
const BACKENDS: readonly LocalLLM[] = [GEMINI_NANO];

let cachedLLM: LocalLLM | null | undefined;

/** 利用可能な backend を 1 つ返す。なければ null。
 *  結果は session 中 memoize される。Chrome が DL を完了するなど環境が
 *  変わって再評価したい場合は force=true で。 */
export async function pickLocalLLM(force = false): Promise<LocalLLM | null> {
  if (!force && cachedLLM !== undefined) return cachedLLM;
  for (const b of BACKENDS) {
    if (await b.availability()) {
      cachedLLM = b;
      return b;
    }
  }
  cachedLLM = null;
  return null;
}

/**
 * caller が呼ぶ標準 API。利用可能な backend で生成、null なら caller が
 * fallback を選ぶ (hand-crafted 文 / 機能 OFF メッセージ など)。
 */
export async function generateWithLocalLLM(
  input: LLMInput,
  opts?: LLMOptions,
): Promise<LLMGenResult | null> {
  const llm = await pickLocalLLM();
  if (!llm) return null;
  const text = await llm.generate(input, opts);
  return { text, backend: llm.id };
}
