/**
 * ブルスコン (LFM2.5、自前 WGSL) を導入する前の空き容量の確認と、導入後の古いキャッシュの掃除 (D-SLM-CARD-001 §2)。
 *
 * - 消してよいのは自分の名前空間 (`slm-wgsl-*` と `sarashina-wgsl-*`) だけ。分類・埋め込み (`cognitive-wgsl-v1`) と
 *   tokenizer (`transformers-cache`)、名前を知らないキャッシュは触らない。
 * - sarashina のキャッシュは、空きがあれば LFM を全部入れて確かめた後で消す (途中で失敗しても sarashina の翻訳は残る)。
 *   空きが足りず、sarashina を消せば足りる時だけ先に消す。
 */
import {
  SARASHINA_CACHE_NAME, SARASHINA_TOKENIZER_BYTES, SARASHINA_TOTAL_BYTES, SLM_BASE_URL, SLM_CACHE_NAME, SLM_TOKENIZER_BYTES, SLM_TOTAL_BYTES,
  type SlmHeader,
} from './slm-wgsl/weights';

/** ダウンロードする量 (重み part と tokenizer.json)。 */
export const SLM_DOWNLOAD_BYTES = SLM_TOTAL_BYTES + SLM_TOKENIZER_BYTES;
/** sarashina のキャッシュが占める量 (重み part と tokenizer.json)。 */
const SARASHINA_CACHED_BYTES = SARASHINA_TOTAL_BYTES + SARASHINA_TOKENIZER_BYTES;
/** 空き容量に求める余裕 (ダウンロード量の 10%)。 */
const MARGIN = 1.1;

export type SlmInstallPlan = 'install-then-drop-sarashina' | 'drop-sarashina-first' | 'not-enough';

export interface StorageEstimateLike { quota: number; usage: number }

/** estimate が取れない (古いブラウザ) 時は確かめようがないので入れてみる (書けなければ cache.put の失敗で止まる)。 */
export function planSlmInstall(estimate: StorageEstimateLike | null, sarashinaCached: boolean): SlmInstallPlan {
  if (!estimate) return 'install-then-drop-sarashina';
  const need = SLM_DOWNLOAD_BYTES * MARGIN;
  const free = estimate.quota - estimate.usage;
  if (free >= need) return 'install-then-drop-sarashina';
  if (sarashinaCached && free + SARASHINA_CACHED_BYTES >= need) return 'drop-sarashina-first';
  return 'not-enough';
}

/** 今の端末で planSlmInstall を決める (確認シートと導入の両方がこれを使う)。 */
export async function checkSlmStorage(): Promise<SlmInstallPlan> {
  let estimate: StorageEstimateLike | null = null;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e && typeof e.quota === 'number' && typeof e.usage === 'number') estimate = { quota: e.quota, usage: e.usage };
  } catch { /* 取れなければ null のまま */ }
  const sarashinaCached = await caches.has(SARASHINA_CACHE_NAME).catch(() => false);
  return planSlmInstall(estimate, sarashinaCached);
}

const OWN_CACHE = /^(slm-wgsl-|sarashina-wgsl-)/;

/**
 * LFM の導入を確かめた後に呼ぶ。自分の名前空間のうち今の LFM 以外のキャッシュ (sarashina・古い版) を消し、
 * 今の LFM のキャッシュからは、今の commit の header に載っていない URL を消す。
 */
export async function dropStaleSlmCaches(header: SlmHeader): Promise<void> {
  for (const name of await caches.keys()) {
    if (name !== SLM_CACHE_NAME && OWN_CACHE.test(name)) await caches.delete(name);
  }
  const keep = new Set(['header.json', ...header.parts.map((p) => p.file), header.tokenizer.file].map((f) => `${SLM_BASE_URL}/${f}`));
  const cache = await caches.open(SLM_CACHE_NAME);
  for (const req of await cache.keys()) {
    if (!keep.has(req.url)) await cache.delete(req);
  }
}
