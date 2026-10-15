/**
 * ModernBERT-ja-30m の tokenizer (cognitive-small と Ruri-v3-30m で tokenizer.json は同一)。
 *
 * @huggingface/tokenizers (純 JS) を直接使う。transformers.js は import しない:
 * transformers.js は読み込むだけで onnxruntime-web を bundle に含め、ORT の wasm を取りに行きうるため。
 * tokenizer.json / tokenizer_config.json は HF から取り、transformers.js 版と同じ Cache API
 * (transformers-cache) に置く (既存ユーザーは取り直しにならない)。
 */
import { Tokenizer } from '@huggingface/tokenizers';
import { MAX_SEQ_TOKENS } from './kernels';

const TOKENIZER_REPO = 'kojira/aozoraquest-cognitive-small';
const CACHE_NAME = 'transformers-cache';

async function fetchJson(file: string): Promise<object> {
  const url = `https://huggingface.co/${TOKENIZER_REPO}/resolve/main/${file}`;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return (await hit.json()) as object;
  } catch {
    cache = null; // Cache API 不可 (private mode 等) はキャッシュなしで続行
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tokenizer fetch failed: ${file} HTTP ${res.status}`);
  if (cache) await cache.put(url, res.clone()).catch(() => {});
  return (await res.json()) as object;
}

export interface ModernBertTokenizer {
  /** CLS/SEP 込みの token id 列。attention の上限 MAX_SEQ_TOKENS に切り詰める (末尾の </s> は残す)。 */
  encode(text: string): number[];
}

export async function loadModernBertTokenizer(): Promise<ModernBertTokenizer> {
  const [json, config] = await Promise.all([fetchJson('tokenizer.json'), fetchJson('tokenizer_config.json')]);
  const tokenizer = new Tokenizer(json, config);
  return {
    encode(text: string): number[] {
      const ids = tokenizer.encode(text).ids;
      if (ids.length <= MAX_SEQ_TOKENS) return ids;
      return [...ids.slice(0, MAX_SEQ_TOKENS - 1), ids[ids.length - 1]!];
    },
  };
}
