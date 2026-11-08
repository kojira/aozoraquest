/**
 * 自前 WGSL エンジンの推論専用 Worker (LFM2.5-1.2B-JP と sarashina2.2-0.5b。1 つの Worker が読むのは 1 モデルだけ)。
 *
 * メッセージ:
 *   { type: 'init', model, allowNetwork }              → { type: 'ready' } / { type: 'error', code? }
 *                                                        (model: 'lfm' | 'sarashina'。
 *                                                         読み込み中は重みの part ごと・ダウンロード中は約 1 秒ごとに { type: 'progress', loaded?, total? } を送る
 *                                                         (loaded / total は重み part の byte 数。header / tokenizer の取得中は数値なし)。
 *                                                         allowNetwork: false はキャッシュだけで読み、欠けていれば code: 'not-cached'。
 *                                                         Cache API に書けなければ code: 'storage-full')
 *   { type: 'generate', id, prompt, maxNewTokens, temperature, repetitionPenalty, stopAtNewline }
 *                                                      → { type: 'done', id, text } / { type: 'error', id }
 *                                                        (生成は 1 本ずつ順に実行する。model の pos / KV / readback は共有)
 *   { type: 'count', id, prompt }                     → { type: 'counted', id, count } (prompt の token 数。カードの prompt が ctx に収まるか)
 *   { type: 'dispose' }                                → GPU buffer を destroy して { type: 'disposed' }
 * GPU device を失ったら { type: 'lost' } を送る (main 側が Worker ごと作り直す)。
 */
import { SlmModel, WebGpuUnsupportedError } from './slm-wgsl/model';
import { createLfmTokenizer, type SlmTokenizer } from './slm-wgsl/lfm-tokenizer';
import { SpTokenizer, type UnigramJson } from './slm-wgsl/sptok';
import {
  fetchHeader, fetchVerified, SARASHINA_SOURCE, SLM_SOURCE, SlmCacheWriteError, SlmNotCachedError, type SlmFetchOptions, type SlmWeightsSource,
} from './slm-wgsl/weights';

export type SlmWorkerModel = 'lfm' | 'sarashina';

interface GenerateMessage {
  type: 'generate';
  id: string;
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  repetitionPenalty: number;
  stopAtNewline: boolean;
}
type IncomingMessage =
  | { type: 'init'; model: SlmWorkerModel; allowNetwork: boolean }
  | GenerateMessage
  | { type: 'count'; id: string; prompt: string }
  | { type: 'dispose' };

const TOP_P = 0.9;
const SOURCES: Record<SlmWorkerModel, SlmWeightsSource> = { lfm: SLM_SOURCE, sarashina: SARASHINA_SOURCE };

let ready: Promise<{ model: SlmModel; tok: SlmTokenizer }> | null = null;
/** init で指定されたモデル (generate はこれをキャッシュから読む)。 */
let loadedModel: SlmWorkerModel = 'lfm';
/** 生成を 1 本ずつ順に流す鎖 (同じ model で 2 本同時に走らせない)。 */
let generating: Promise<unknown> = Promise.resolve();

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

/** 読み込み済みならそれを返す。未読み込みなら opts に従って読む (generate からはキャッシュだけ)。 */
function ensureReady(which: SlmWorkerModel, { allowNetwork }: SlmFetchOptions) {
  if (!ready) {
    const source = SOURCES[which];
    // ダウンロード中も byte が届く間は progress を送り、main 側の停止監視 (LOAD_STALL_MS) を進める (Refs #779)
    const opts: SlmFetchOptions = { allowNetwork, onHeartbeat: () => post({ type: 'progress' }) };
    ready = (async () => {
      const header = await fetchHeader(source, opts);
      const tj = JSON.parse(new TextDecoder().decode(await fetchVerified(source, header.tokenizer.file, header.tokenizer, opts))) as object;
      const tok = which === 'lfm' ? createLfmTokenizer(tj) : new SpTokenizer(tj as UnigramJson);
      const model = await SlmModel.create(source, header, (loaded, total) => post({ type: 'progress', loaded, total }), opts);
      void model.lost.then(() => { ready = null; post({ type: 'lost' }); });
      return { model, tok };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

async function generate(m: GenerateMessage): Promise<string> {
  const { model, tok } = await ensureReady(loadedModel, { allowNetwork: false });
  const nl = new Set<number>();
  const sample = { temperature: m.temperature, topP: TOP_P, repetitionPenalty: m.repetitionPenalty };
  const out = await model.generate(tok.encode(m.prompt), m.maxNewTokens, sample, (id) => {
    if (!m.stopAtNewline) return true;
    if (nl.has(id)) return false;
    if (tok.decode([id]).includes('\n')) { nl.add(id); return false; }
    return true;
  });
  return tok.decode(out, { skip_special_tokens: true });
}

function errorCode(e: unknown): string | undefined {
  if (e instanceof WebGpuUnsupportedError) return 'webgpu-unsupported';
  if (e instanceof SlmNotCachedError) return 'not-cached';
  if (e instanceof SlmCacheWriteError) return 'storage-full';
  return undefined;
}

self.addEventListener('message', (ev: MessageEvent<IncomingMessage>) => {
  const m = ev.data;
  if (m.type === 'init') {
    loadedModel = m.model;
    ensureReady(m.model, { allowNetwork: m.allowNetwork }).then(
      () => post({ type: 'ready' }),
      (e: unknown) => post({ type: 'error', code: errorCode(e), error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'generate') {
    generating = generating.then(() => generate(m)).then(
      (text) => post({ type: 'done', id: m.id, text }),
      (e: unknown) => post({ type: 'error', id: m.id, error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'count') {
    ensureReady(loadedModel, { allowNetwork: false }).then(
      ({ tok }) => post({ type: 'counted', id: m.id, count: tok.encode(m.prompt).length }),
      (e: unknown) => post({ type: 'error', id: m.id, error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'dispose') {
    const r = ready;
    ready = null;
    (r ?? Promise.reject(new Error('not loaded'))).then(({ model }) => model.dispose()).catch(() => {}).finally(() => post({ type: 'disposed' }));
  }
});
