#!/usr/bin/env bash
# verify 専用 secp256k1 wasm をビルドし、成果物を apps/edge/src/vendor/secp256k1-verify/ に出す。
# 成果物は commit するので CI では走らせない (ローカルで鍵鎖更新時のみ)。
# 必要: rustc + cargo + wasm-pack + rustup target wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")"
wasm-pack build --target web --release \
  --out-dir ../../src/vendor/secp256k1-verify \
  --out-name secp256k1_verify
# サイズ表示
ls -la ../../src/vendor/secp256k1-verify/*.wasm
