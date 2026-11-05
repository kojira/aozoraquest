/**
 * ブルスコン (LFM2.5-1.2B-JP、int4、自前 WGSL、slm.worker.ts) を LocalLLM として実装 (D-SLM-CARD-001)。
 *
 * - 対象端末: Gemini Nano が無く (`detectGeminiNano() === 'unavailable'`) WebGPU がある端末 (iOS 26+ Safari、Android Chrome)。
 *   Nano のある PC は local-llm.ts の BACKENDS 順で Nano が先に選ばれ、ここには来ない。
 * - 導入 (約 660MB の初回ダウンロード) は `installSlm()` (確認シートで承諾した召喚の儀式) だけが行う。availability() は「導入済み」の時だけ true。
 *   翻訳時の読み込み (`loadSlm()` / generate()) はキャッシュだけを読み、ネットワークからは取らない。
 *   キャッシュが消されていたら SlmNotInstalledError で失敗し、未導入に戻す (翻訳 UI は消え、精霊タブの儀式ボタンが戻る)。
 * - 導入の前に空き容量を見て、足りなければ始めない (SlmStorageFullError)。書けなかった時も同じ扱いで、中途半端な LFM のキャッシュは消す。
 *   導入を確かめた後で、sarashina と古い版のキャッシュを消す (slm-install.ts)。
 */
import type { LLMInput, LLMOptions, LocalLLM } from './local-llm';
import { detectGeminiNano } from './gemini-nano-availability';
import { createSlmClient, SlmNotInstalledError, SlmStorageFullError, type SlmProgress } from './slm-client';
import { checkSlmStorage, dropStaleSlmCaches } from './slm-install';
import { lfmChatPrompt } from './slm-wgsl/lfm-tokenizer';
import { fetchHeader, isSlmCached, SARASHINA_CACHE_NAME, SLM_CACHE_NAME, SLM_SOURCE } from './slm-wgsl/weights';

export { SlmNotInstalledError, SlmStorageFullError } from './slm-client';

/** 1 回の出力上限 (カードは maxNewTokens で 160 を渡す)。 */
const MAX_NEW_TOKENS = 200;

const client = createSlmClient('lfm');
let installed: boolean | null = null;

/** ブルスコンを使う端末か (Nano が無く WebGPU がある)。導入済みかは問わない。 */
export async function isSlmEligible(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return false;
  return (await detectGeminiNano()) === 'unavailable';
}

export async function isSlmInstalled(): Promise<boolean> {
  installed ??= await isSlmCached(SLM_SOURCE);
  return installed;
}

/**
 * 重みとトークナイザをダウンロードして検証し、GPU に載せる (確認シートで承諾した召喚の儀式から呼ぶ)。
 * onProgress には重み part の届いた byte 数と合計を渡す。失敗したら throw し、導入済みにはしない。
 */
export async function installSlm(onProgress?: SlmProgress): Promise<void> {
  const plan = await checkSlmStorage();
  if (plan === 'not-enough') throw new SlmStorageFullError('estimate');
  if (plan === 'drop-sarashina-first') await caches.delete(SARASHINA_CACHE_NAME).catch(() => false);
  // 翻訳時のキャッシュだけの読み込みが走っていたら終わるのを待つ (失敗していれば Worker は捨てられ、下で取り直す)
  await client.settle();
  try {
    await client.ensure(true, onProgress);
  } catch (e) {
    // 書けなかった (空きが足りない): 中途半端な LFM のキャッシュを消して容量を返す
    if (e instanceof SlmStorageFullError) await caches.delete(SLM_CACHE_NAME).catch(() => false);
    throw e;
  }
  installed = await isSlmCached(SLM_SOURCE);
  if (!installed) { client.dispose(); throw new Error('slm cache incomplete after load'); }
  await dropStaleSlmCaches(await fetchHeader(SLM_SOURCE, { allowNetwork: false })).catch((e: unknown) => console.warn('[slm] cache cleanup failed', e));
  void navigator.storage?.persist?.().catch(() => false);
}

/**
 * キャッシュからモデルを GPU に載せ終えるまで待つ (翻訳の制限時間に読み込み時間を含めないため、translate.ts が生成の前に呼ぶ)。
 * ダウンロードはしない。キャッシュが欠けていれば SlmNotInstalledError (未導入に戻る)。
 */
export async function loadSlm(): Promise<void> {
  try {
    await client.ensure(false);
  } catch (e) {
    if (e instanceof SlmNotInstalledError) installed = false;
    throw e;
  }
}

async function generate(input: LLMInput, opts: LLMOptions = {}): Promise<string> {
  const last = input.history[input.history.length - 1];
  if (!last || last.role !== 'user') throw new Error('last history entry must be a user turn');
  await loadSlm();
  return client.generate({
    prompt: lfmChatPrompt(input),
    maxNewTokens: Math.min(opts.maxNewTokens ?? MAX_NEW_TOKENS, MAX_NEW_TOKENS),
    temperature: opts.temperature ?? 0,
    repetitionPenalty: 1,
    stopAtNewline: opts.stopAtNewline ?? false,
    signal: opts.signal,
  });
}

export const SLM: LocalLLM = {
  id: 'lfm2.5-1.2b-jp',
  label: 'ブルスコン (LFM2.5-1.2B-JP)',
  purposes: ['translation'],
  async availability() {
    return (await isSlmEligible()) && (await isSlmInstalled());
  },
  generate,
};
