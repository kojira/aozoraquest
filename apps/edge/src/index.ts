import { handleRequest, type Env } from './router';
// verify 専用 secp256k1 WASM を起動時に一度だけ初期化 (wrangler は .wasm を WebAssembly.Module
// として bundle する。docs/21 §4.2)。
import wasmModule from './vendor/secp256k1-verify/secp256k1_verify_bg.wasm';
import { initSecp256k1 } from './secp256k1-wasm';
import { runCronRefresh } from './oauth-cron';
import { ensureAuthoredWorld } from './world-authoring';

initSecp256k1(wasmModule);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // 手編集した世界を読む (#421)。**移動判定はここ (edge) が権威**なので、web と同じ
    // 地図を見ていないと「画面では歩けるのにサーバーが弾く」= その場から動けなくなる。
    // **待たない** — 読み込むまでは同梱の地図 / ノイズ生成に倒れるだけで一貫している。
    ensureAuthoredWorld(env, nsidRoot(req), Math.floor(Date.now() / 1000));
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

/** NSID の根 (world.map / world.tileArt の collection を組む)。web の ADMIN_COL と揃える。 */
function nsidRoot(req: Request): string {
  // 管理系レコードは env で分けない (全環境が同じ 1 か所を見る)。web の collections.ts と同じ規則。
  void req;
  return 'app.aozoraquest';
}
