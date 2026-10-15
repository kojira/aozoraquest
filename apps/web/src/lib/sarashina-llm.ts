/**
 * sarashina2.2-0.5b-instruct (int4、自前 WGSL、slm.worker.ts) を LocalLLM として実装。投稿翻訳専用。
 *
 * - 対象端末: Gemini Nano が無く (`detectGeminiNano() === 'unavailable'`) WebGPU がある端末 (iOS 26+ Safari、Android Chrome)。
 *   Nano のある PC は local-llm.ts の BACKENDS 順で Nano が先に選ばれ、ここには来ない。
 * - 導入 (約 430MB の初回ダウンロード) は `installSarashina()` (召喚の儀式) だけが行う。availability() は「導入済み」の時だけ true。
 *   翻訳時の読み込み (`loadSarashina()` / generate()) はキャッシュだけを読み、ネットワークからは取らない。
 *   キャッシュが消されていたら SarashinaNotInstalledError で失敗し、未導入に戻す (翻訳 UI は消え、次の儀式で入れ直す)。
 * - Worker は初めて生成が要る時に作り、最後の生成から 3 分で解放する。pagehide でも解放し、GPU device を失ったら作り直す。
 * - 1 回の生成は最初の改行か EOS で止まる (訳文の後に説明を書き足す癖への対策。複数段落は translate.ts が段落ごとに呼ぶ)。
 */

import type { LLMInput, LLMOptions, LocalLLM } from './local-llm';
import { detectGeminiNano } from './gemini-nano-availability';
import { isSarashinaCached } from './slm-wgsl/weights';

const IDLE_DISPOSE_MS = 3 * 60_000;
/** 読み込み中にこの間 part が 1 つも届かなければ止まったとみなして Worker を捨てる (総時間の上限は設けない)。 */
const LOAD_STALL_MS = 60_000;
/** 1 回の出力上限。訳文 1 段落には十分で、暴走時の待ちを抑える。 */
const MAX_NEW_TOKENS = 200;

/** chat template (BOS なし、EOS `</s>`)。history は user / assistant の往復 (few-shot) をそのまま並べる。 */
export function sarashinaChatPrompt(input: LLMInput): string {
  let s = input.systemPrompt.trim() ? `<|system|>${input.systemPrompt.trim()}</s>` : '';
  for (const m of input.history) s += `<|${m.role}|>${m.content.trim()}</s>`;
  return `${s}<|assistant|>`;
}

/** 翻訳時の読み込みで、導入済みのはずのキャッシュが欠けていた (ブラウザに消された)。未導入に戻した。 */
export class SarashinaNotInstalledError extends Error {
  constructor(detail: string) {
    super(`sarashina not installed: ${detail}`);
    this.name = 'SarashinaNotInstalledError';
  }
}

interface Pending { resolve: (text: string) => void; reject: (e: Error) => void }

let worker: Worker | null = null;
let workerReady: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 0;
const pending = new Map<string, Pending>();
let installed: boolean | null = null;

function disposeWorker() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const w = worker;
  worker = null;
  workerReady = null;
  for (const p of pending.values()) p.reject(new Error('sarashina worker disposed'));
  pending.clear();
  if (!w) return;
  const kill = setTimeout(() => w.terminate(), 2000);
  w.addEventListener('message', (ev) => {
    if (ev.data?.type === 'disposed') { clearTimeout(kill); w.terminate(); }
  });
  w.postMessage({ type: 'dispose' });
}

/** Worker を作って読み込む。allowNetwork: true は導入 (召喚の儀式) だけ。読み込み済み / 読み込み中ならそれを返す。 */
function ensureWorker(allowNetwork: boolean): Promise<void> {
  if (workerReady) return workerReady;
  const w = new Worker(new URL('./slm.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'lost') {
      if (worker === w) { worker = null; workerReady = null; }
      w.terminate();
      for (const p of pending.values()) p.reject(new Error('sarashina GPU device lost'));
      pending.clear();
      return;
    }
    if (!m.id) return;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.type === 'done') p.resolve(m.text as string);
    else p.reject(new Error(String(m.error)));
  });
  const ready = new Promise<void>((resolve, reject) => {
    let stall = setTimeout(onStall, LOAD_STALL_MS);
    function onStall() { w.removeEventListener('message', onMsg); reject(new Error(`sarashina load stalled (${LOAD_STALL_MS}ms without progress)`)); }
    const onMsg = (ev: MessageEvent) => {
      if (ev.data.type === 'progress') { clearTimeout(stall); stall = setTimeout(onStall, LOAD_STALL_MS); }
      else if (ev.data.type === 'ready') { clearTimeout(stall); w.removeEventListener('message', onMsg); resolve(); }
      else if (ev.data.type === 'error' && !ev.data.id) {
        clearTimeout(stall);
        w.removeEventListener('message', onMsg);
        if (ev.data.code === 'not-cached') { installed = false; reject(new SarashinaNotInstalledError(String(ev.data.error))); }
        else reject(new Error(String(ev.data.error)));
      }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', (ev) => { clearTimeout(stall); reject(new Error(`sarashina worker failed: ${ev.message}`)); }, { once: true });
    w.postMessage({ type: 'init', allowNetwork });
  });
  workerReady = ready;
  ready.catch((e: unknown) => { console.warn('[sarashina] init failed', e); if (worker === w) disposeWorker(); });
  return ready;
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(disposeWorker, IDLE_DISPOSE_MS);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', disposeWorker);

/** sarashina を使う端末か (Nano が無く WebGPU がある)。導入済みかは問わない。 */
export async function isSarashinaEligible(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) return false;
  return (await detectGeminiNano()) === 'unavailable';
}

/**
 * 重みとトークナイザをダウンロードして検証し、GPU に載せる (召喚の儀式から呼ぶ)。
 * 失敗したら throw し、導入済みにはしない (次の儀式・次の呼び出しでやり直す)。
 */
export async function installSarashina(): Promise<void> {
  // 翻訳時のキャッシュだけの読み込みが走っていたら終わるのを待つ (失敗していれば Worker は捨てられ、下で取り直す)
  if (workerReady) await workerReady.catch(() => undefined);
  await ensureWorker(true);
  installed = await isSarashinaCached();
  if (!installed) { disposeWorker(); throw new Error('sarashina cache incomplete after load'); }
  touchIdle();
  void navigator.storage?.persist?.().catch(() => false);
}

/**
 * キャッシュからモデルを GPU に載せ終えるまで待つ (翻訳の制限時間に読み込み時間を含めないため、translate.ts が生成の前に呼ぶ)。
 * ダウンロードはしない。キャッシュが欠けていれば SarashinaNotInstalledError (未導入に戻る)。
 */
export function loadSarashina(): Promise<void> {
  return ensureWorker(false);
}

export async function isSarashinaInstalled(): Promise<boolean> {
  installed ??= await isSarashinaCached();
  return installed;
}

async function generate(input: LLMInput, opts: LLMOptions = {}): Promise<string> {
  const last = input.history[input.history.length - 1];
  if (!last || last.role !== 'user') throw new Error('last history entry must be a user turn');
  await ensureWorker(false);
  const w = worker;
  if (!w) throw new Error('sarashina worker disposed');
  const id = String(nextId++);
  try {
    return await new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      opts.signal?.addEventListener('abort', () => { pending.delete(id); reject(new Error('aborted')); });
      w.postMessage({
        type: 'generate',
        id,
        prompt: sarashinaChatPrompt(input),
        maxNewTokens: Math.min(opts.maxNewTokens ?? MAX_NEW_TOKENS, MAX_NEW_TOKENS),
        temperature: opts.temperature ?? 0,
        stopAtNewline: true,
      });
    });
  } finally {
    touchIdle();
  }
}

export const SARASHINA: LocalLLM = {
  id: 'sarashina-0.5b',
  label: '端末内 AI (sarashina)',
  purposes: ['translation'],
  async availability() {
    return (await isSarashinaEligible()) && (await isSarashinaInstalled());
  },
  generate,
};
