/**
 * sarashina2.2-0.5b (自前 WGSL) の推論専用 Worker。Gemini Nano の無い端末の投稿翻訳だけに使う。
 *
 * メッセージ:
 *   { type: 'init', allowNetwork }                     → { type: 'ready' } / { type: 'error', code? }
 *                                                        (読み込み中は重みの part ごと・ダウンロード中は約 1 秒ごとに { type: 'progress' } を送る。
 *                                                         allowNetwork: false はキャッシュだけで読み、欠けていれば code: 'not-cached')
 *   { type: 'generate', id, prompt, maxNewTokens, temperature, stopAtNewline }
 *                                                      → { type: 'done', id, text } / { type: 'error', id }
 *                                                        (生成は 1 本ずつ順に実行する。model の pos / KV / readback は共有)
 *   { type: 'dispose' }                                → GPU buffer を destroy して { type: 'disposed' }
 * GPU device を失ったら { type: 'lost' } を送る (main 側が Worker ごと作り直す)。
 */
import { SlmModel, WebGpuUnsupportedError } from './slm-wgsl/model';
import { SpTokenizer, type UnigramJson } from './slm-wgsl/sptok';
import { fetchHeader, fetchVerified, SARASHINA_BASE_URL, SarashinaNotCachedError, type SarashinaFetchOptions } from './slm-wgsl/weights';

interface GenerateMessage {
  type: 'generate';
  id: string;
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  stopAtNewline: boolean;
}
type IncomingMessage = { type: 'init'; allowNetwork: boolean } | GenerateMessage | { type: 'dispose' };

const TOP_P = 0.9;

let ready: Promise<{ model: SlmModel; tok: SpTokenizer }> | null = null;
/** 生成を 1 本ずつ順に流す鎖 (同じ model で 2 本同時に走らせない)。 */
let generating: Promise<unknown> = Promise.resolve();

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

/** 読み込み済みならそれを返す。未読み込みなら opts に従って読む (generate からはキャッシュだけ)。 */
function ensureReady({ allowNetwork }: SarashinaFetchOptions) {
  if (!ready) {
    // ダウンロード中も byte が届く間は progress を送り、main 側の停止監視 (LOAD_STALL_MS) を進める (Refs #779)
    const opts: SarashinaFetchOptions = { allowNetwork, onHeartbeat: () => post({ type: 'progress' }) };
    ready = (async () => {
      const header = await fetchHeader(opts);
      const tj = JSON.parse(new TextDecoder().decode(await fetchVerified(`${SARASHINA_BASE_URL}/${header.tokenizer.file}`, header.tokenizer, opts))) as UnigramJson;
      const tok = new SpTokenizer(tj);
      const model = await SlmModel.create(SARASHINA_BASE_URL, header, () => post({ type: 'progress' }), opts);
      void model.lost.then(() => { ready = null; post({ type: 'lost' }); });
      return { model, tok };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

async function generate(m: GenerateMessage): Promise<string> {
  const { model, tok } = await ensureReady({ allowNetwork: false });
  const nl = new Set<number>();
  const out = await model.generate(tok.encode(m.prompt), m.maxNewTokens, { temperature: m.temperature, topP: TOP_P }, (id) => {
    if (!m.stopAtNewline) return true;
    if (nl.has(id)) return false;
    if (tok.decode([id]).includes('\n')) { nl.add(id); return false; }
    return true;
  });
  return tok.decode(out, { skip_special_tokens: true });
}

function errorCode(e: unknown): string | undefined {
  if (e instanceof WebGpuUnsupportedError) return 'webgpu-unsupported';
  if (e instanceof SarashinaNotCachedError) return 'not-cached';
  return undefined;
}

self.addEventListener('message', (ev: MessageEvent<IncomingMessage>) => {
  const m = ev.data;
  if (m.type === 'init') {
    ensureReady({ allowNetwork: m.allowNetwork }).then(
      () => post({ type: 'ready' }),
      (e: unknown) => post({ type: 'error', code: errorCode(e), error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'generate') {
    generating = generating.then(() => generate(m)).then(
      (text) => post({ type: 'done', id: m.id, text }),
      (e: unknown) => post({ type: 'error', id: m.id, error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'dispose') {
    const r = ready;
    ready = null;
    (r ?? Promise.reject(new Error('not loaded'))).then(({ model }) => model.dispose()).catch(() => {}).finally(() => post({ type: 'disposed' }));
  }
});
