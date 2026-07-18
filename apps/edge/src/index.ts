import { handleRequest, type Env } from './router';
// verify 専用 secp256k1 WASM を起動時に一度だけ初期化 (wrangler は .wasm を WebAssembly.Module
// として bundle する。docs/21 §4.2)。
import wasmModule from './vendor/secp256k1-verify/secp256k1_verify_bg.wasm';
import { initSecp256k1 } from './secp256k1-wasm';

initSecp256k1(wasmModule);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
};
