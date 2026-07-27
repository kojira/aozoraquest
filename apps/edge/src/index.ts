import { handleRequest, type Env } from './router';
// verify 専用 secp256k1 WASM を起動時に一度だけ初期化 (wrangler は .wasm を WebAssembly.Module
// として bundle する。docs/21 §4.2)。
import wasmModule from './vendor/secp256k1-verify/secp256k1_verify_bg.wasm';
import { initSecp256k1 } from './secp256k1-wasm';
import { runCronRefresh } from './oauth-cron';
import { loadStaticWorldMap } from '@aozoraquest/core';

initSecp256k1(wasmModule);

/**
 * 地形の地図を読み込む (#421)。**移動判定はここ (edge) が権威**なので、web と同じ地図を
 * 見ていないと「画面では歩けるのにサーバーが弾く」= その場から動けなくなる。
 *
 * isolate ごとに 1 回。**待たない** — 読み込むまでは従来のノイズ生成に倒れるだけで
 * 結果は一致するので、最初のリクエストを 8 ms 遅らせる理由がない。
 * 失敗しても握り潰す (生成に倒れて動き続ける)。
 */
let mapLoad: Promise<void> | null = null;
function ensureWorldMap(): void {
  if (mapLoad) return;
  mapLoad = loadStaticWorldMap().catch((e) => {
    console.warn('world map load failed (ノイズ生成に倒れます)', e);
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    ensureWorldMap();
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
