#!/usr/bin/env python3
"""docs/bench を COOP/COEP 付きでサーブする静的 HTTP サーバ。

これが必要な理由: ONNX Runtime Web の WASM マルチスレッド (SharedArrayBuffer)
は cross-origin isolation が有効な origin でしか動かない。python -m http.server
は COOP/COEP ヘッダを返さないため、WASM は単一スレッドで走り遅い。

Usage:
  python3 scripts/serve-bench.py [port]
"""

from __future__ import annotations

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BENCH_DIR = REPO_ROOT / "docs/bench"


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        # cross-origin isolation: SharedArrayBuffer 有効化
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        # ONNX MB 級 fetch をキャッシュさせる
        if self.path.endswith(".onnx"):
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    os.chdir(BENCH_DIR)
    print(f"serving {BENCH_DIR} at http://127.0.0.1:{port}/ (COOP/COEP enabled)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
