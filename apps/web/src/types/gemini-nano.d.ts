/**
 * Chrome 148+ の built-in AI (Gemini Nano) Prompt API グローバル型宣言。
 * 公式 @types パッケージが無いため手書き。
 *
 * Spec: https://developer.chrome.com/docs/ai/prompt-api
 */

interface LanguageModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LanguageModelExpected {
  type: 'text';
  languages?: string[];
}

interface LanguageModelCreateOptions {
  initialPrompts?: LanguageModelMessage[];
  temperature?: number;
  topK?: number;
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
  monitor?: (m: EventTarget) => void;
  signal?: AbortSignal;
}

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
  responseConstraint?: unknown;
}

interface LanguageModelSession {
  prompt(input: string, opts?: LanguageModelPromptOptions): Promise<string>;
  promptStreaming(input: string, opts?: LanguageModelPromptOptions): ReadableStream<string>;
  append(messages: LanguageModelMessage[]): Promise<void>;
  clone(opts?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
  readonly inputUsage: number;
  readonly inputQuota: number;
}

type LanguageModelAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface LanguageModelGlobal {
  availability(
    opts?: Pick<LanguageModelCreateOptions, 'expectedInputs' | 'expectedOutputs'>,
  ): Promise<LanguageModelAvailability>;
  create(opts?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

declare const LanguageModel: LanguageModelGlobal | undefined;
