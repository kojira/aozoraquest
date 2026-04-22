#!/usr/bin/env python3
"""ベストモデルを fp32 ONNX → int8 dynamic / int4 MatMul4Bits に量子化する。

前提: optimum-cli で fp32 ONNX 出力済み
   docs/runs/20260422-022431-clean-jp-18k/epochs/17/onnx-fp32/model.onnx

出力:
   docs/runs/.../epochs/17/onnx-int8/model.onnx   (int8 dynamic, MatMul weights)
   docs/runs/.../epochs/17/onnx-int4/model.onnx   (int4 MatMul4Bits, block=32)
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

import onnx
from onnxruntime.quantization import QuantType, quantize_dynamic
from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE = REPO_ROOT / "docs/runs/20260422-022431-clean-jp-18k/epochs/17"
FP32 = BASE / "onnx-fp32"
INT8 = BASE / "onnx-int8"
INT4 = BASE / "onnx-int4"


def _copy_tokenizer(src: Path, dst: Path) -> None:
    dst.mkdir(parents=True, exist_ok=True)
    for name in ["config.json", "tokenizer.json", "tokenizer.model",
                 "tokenizer_config.json", "special_tokens_map.json"]:
        p = src / name
        if p.exists():
            shutil.copy2(p, dst / name)


def quantize_int8() -> None:
    print(f"[int8] input: {FP32}/model.onnx")
    INT8.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    quantize_dynamic(
        str(FP32 / "model.onnx"),
        str(INT8 / "model.onnx"),
        weight_type=QuantType.QInt8,
    )
    _copy_tokenizer(FP32, INT8)
    dt = time.time() - t0
    size = (INT8 / "model.onnx").stat().st_size / 1024 / 1024
    print(f"[int8] done in {dt:.1f}s  size={size:.1f} MB  → {INT8}/model.onnx")


def quantize_int4() -> None:
    print(f"[int4] input: {FP32}/model.onnx")
    INT4.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    model = onnx.load(str(FP32 / "model.onnx"))
    q = MatMul4BitsQuantizer(
        model,
        block_size=32,
        is_symmetric=True,
    )
    q.process()
    onnx.save_model(
        q.model.model,
        str(INT4 / "model.onnx"),
        save_as_external_data=False,
    )
    _copy_tokenizer(FP32, INT4)
    dt = time.time() - t0
    size = (INT4 / "model.onnx").stat().st_size / 1024 / 1024
    print(f"[int4] done in {dt:.1f}s  size={size:.1f} MB  → {INT4}/model.onnx")


if __name__ == "__main__":
    quantize_int8()
    quantize_int4()
