/**
 * sarashina2.2-0.5b (自前 WGSL) の推論専用 Worker。Gemini Nano の無い端末の投稿翻訳だけに使う。
 *
 * メッセージ:
 *   { type: 'init' }                                   → { type: 'ready' } / { type: 'error', code? }
 *   { type: 'generate', id, prompt, maxNewTokens, temperature, stopAtNewline }
 *                                                      → { type: 'done', id, text } / { type: 'error', id }
 *   { type: 'dispose' }                                → GPU buffer を destroy して { type: 'disposed' }
 * GPU device を失ったら { type: 'lost' } を送る (main 側が Worker ごと作り直す)。
 */
import { SlmModel, WebGpuUnsupportedError } from './slm-wgsl/model';
import { SpTokenizer, type UnigramJson } from './slm-wgsl/sptok';
import { fetchHeader, fetchVerified, SARASHINA_BASE_URL } from './slm-wgsl/weights';

interface GenerateMessage {
  type: 'generate';
  id: string;
  prompt: string;
  maxNewTokens: number;
  temperature: number;
  stopAtNewline: boolean;
}
type IncomingMessage = { type: 'init' } | GenerateMessage | { type: 'dispose' };

const TOP_P = 0.9;

let ready: Promise<{ model: SlmModel; tok: SpTokenizer }> | null = null;

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const header = await fetchHeader();
      const tj = JSON.parse(new TextDecoder().decode(await fetchVerified(`${SARASHINA_BASE_URL}/${header.tokenizer.file}`, header.tokenizer))) as UnigramJson;
      const tok = new SpTokenizer(tj);
      const model = await SlmModel.create(SARASHINA_BASE_URL, header, () => {});
      void model.lost.then(() => { ready = null; post({ type: 'lost' }); });
      return { model, tok };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

async function generate(m: GenerateMessage): Promise<string> {
  const { model, tok } = await ensureReady();
  const nl = new Set<number>();
  const out = await model.generate(tok.encode(m.prompt), m.maxNewTokens, { temperature: m.temperature, topP: TOP_P }, (id) => {
    if (!m.stopAtNewline) return true;
    if (nl.has(id)) return false;
    if (tok.decode([id]).includes('\n')) { nl.add(id); return false; }
    return true;
  });
  return tok.decode(out, { skip_special_tokens: true });
}

self.addEventListener('message', (ev: MessageEvent<IncomingMessage>) => {
  const m = ev.data;
  if (m.type === 'init') {
    ensureReady().then(
      () => post({ type: 'ready' }),
      (e: unknown) => post({ type: 'error', code: e instanceof WebGpuUnsupportedError ? 'webgpu-unsupported' : undefined, error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'generate') {
    generate(m).then(
      (text) => post({ type: 'done', id: m.id, text }),
      (e: unknown) => post({ type: 'error', id: m.id, error: String((e as Error)?.message ?? e) }),
    );
  } else if (m.type === 'dispose') {
    const r = ready;
    ready = null;
    (r ?? Promise.reject(new Error('not loaded'))).then(({ model }) => model.dispose()).catch(() => {}).finally(() => post({ type: 'disposed' }));
  }
});
