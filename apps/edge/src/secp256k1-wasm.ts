/**
 * verify 専用 secp256k1 (ES256K) WASM のラッパ。
 * wasm 本体は apps/edge/wasm/secp256k1-verify (Rust k256) をビルドした ~51KB (docs/21 §4.2)。
 * 初期化は環境ごとに wasm を渡して一度だけ:
 *   - Worker: index.ts が `import wasm from './vendor/.../*.wasm'` (WebAssembly.Module) を渡す。
 *   - テスト (node): fs で読んだ bytes を渡す。
 */
import { initSync, verify as wasmVerify } from './vendor/secp256k1-verify/secp256k1_verify.js';

let ready = false;

/** wasm を初期化 (WebAssembly.Module か wasm bytes)。冪等。 */
export function initSecp256k1(module: WebAssembly.Module | BufferSource): void {
  if (ready) return;
  initSync({ module });
  ready = true;
}

/**
 * ES256K 署名検証。msg = 署名対象 (JWT signing input、内部で SHA-256)、pubkey = SEC1
 * (圧縮 33B/非圧縮 65B)、sig = raw r||s 64B。未初期化なら例外 (fail-closed)。
 */
export function verifySecp256k1(msg: Uint8Array, pubkey: Uint8Array, sig: Uint8Array): boolean {
  if (!ready) throw new Error('secp256k1 wasm 未初期化 (initSecp256k1 を先に呼ぶこと)');
  return wasmVerify(msg, pubkey, sig);
}
