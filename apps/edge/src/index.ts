import { handleRequest, type Env } from './router';
// verify 専用 secp256k1 WASM を起動時に一度だけ初期化 (wrangler は .wasm を WebAssembly.Module
// として bundle する。docs/21 §4.2)。
import wasmModule from './vendor/secp256k1-verify/secp256k1_verify_bg.wasm';
import { initSecp256k1 } from './secp256k1-wasm';
import { runCronRefresh } from './oauth-cron';
import { ensureAuthoredWorld } from './world-authoring';

initSecp256k1(wasmModule);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 手編集した世界を読む (#421)。**移動判定はここ (edge) が権威**なので、web と同じ
    // 地図を見ていないと「画面では歩けるのにサーバーが弾く」= その場から動けなくなる。
    //
    // **必ず ctx.waitUntil に載せる。** fire-and-forget にすると、リクエストが同期的に
    // return した瞬間 (CORS preflight の OPTIONS が該当) に I/O コンテキストごと捨てられ、
    // promise が **reject もせず settle しない**。.catch() も走らないので警告すら出ず、
    // 読み込み中フラグがラッチされたままで **その isolate は二度と地図を読まない**
    // (workerd で実測)。結果、web は地図あり・edge は地図なしで地形の認識がずれる。
    // 管理系レコードの NSID の根は env で分けない (world-authoring の ADMIN_NSID_ROOT)。
    ctx.waitUntil(ensureAuthoredWorld(env, Math.floor(Date.now() / 1000)));
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
