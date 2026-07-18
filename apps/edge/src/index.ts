import { handleRequest, type Env } from './router';
// verify 専用 secp256k1 WASM を起動時に一度だけ初期化 (wrangler は .wasm を WebAssembly.Module
// として bundle する。docs/21 §4.2)。
import wasmModule from './vendor/secp256k1-verify/secp256k1_verify_bg.wasm';
import { initSecp256k1 } from './secp256k1-wasm';
import { runCronRefresh } from './oauth-cron';

initSecp256k1(wasmModule);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },

  // OAuth トークンの唯一の refresh 実行者 (docs/21 §12)。Cron Trigger から定期起動。
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const r = await runCronRefresh(env, Math.floor(Date.now() / 1000));
    if (r.status === 'error' || r.status === 'not-configured') {
      console.error(`oauth cron refresh: ${r.status} ${r.detail ?? ''}`);
    }
  },
};
