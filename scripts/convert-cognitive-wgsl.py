#!/usr/bin/env python3
"""ModernBERT-ja-30m 系の fp32 ONNX を WGSL 推論用の重みファイル (.aqw) に変換する。

入力 (どちらも fp32 の onnx/model.onnx):
  - HF kojira/aozoraquest-cognitive-small (9-class 分類器) → model.aqw (config.head = "classifier")
  - HF sirasagi62/ruri-v3-30m-ONNX (埋め込み、classifier なし) → ruri-v3-30m.aqw (config.head = "mean-pool")
    元モデルは cl-nagoya/ruri-v3-30m (Apache-2.0)。変換後のファイルも Apache-2.0 で、
    帰属は HF kojira/aozoraquest-cognitive-small の README に記す。
出力: ブラウザが fetch しながら層ごとに GPU buffer へ流し込む形式。

形式 (little endian):
  [0:4]   magic "AQW1"
  [4:8]   u32 headerBytes (JSON を 4 byte 境界まで空白で埋めた長さ)
  [8:8+headerBytes]  JSON header {format, config, tensors:[{name,dtype,shape,offset,bytes}]}
  以降     tensor 本体。offset は本体先頭からの byte 位置で、すべて 4 byte 境界。
dtype:
  f32  — float32 (norm 重み, classifier)
config.head: 省略時は "classifier" (CLS → head → 9 logits)。"mean-pool" は head / classifier の tensor を持たず、
  ブラウザは最終 LayerNorm 後の hidden を系列内で平均して L2 正規化する。
  f16  — float16。行列は [out, in] (転置済み、in 方向が連続) で、WGSL は u32 に 2 個ずつ詰めて
         unpack2x16float で読む (shader-f16 拡張は不要)
  i8   — int8。埋め込みのみ。行ごとの対称量子化で、scale は別 tensor (f32, 行数ぶん)
tensor 順は「小さい tensor → 各層 → 埋め込み」。ブラウザは到着順に GPU へ書くだけなので
CPU 側に全体のコピーを持たない。

使い方: python3 scripts/convert-cognitive-wgsl.py <model.onnx> <out.aqw>
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import numpy_helper

HIDDEN = 256
LAYERS = 10
INTERMEDIATE = 1024
VOCAB = 102400
LABELS = ["Ni", "Ne", "Si", "Se", "Ti", "Te", "Fi", "Fe", "none"]


def matmul_weight_names(init: dict[str, np.ndarray], with_head: bool) -> list[str]:
    """ONNX export では層の Linear 重みが onnx::MatMul_<n> という名前になる。
    番号順に Wqkv, Wo, Wi, mlp.Wo を 10 層ぶん (+ 分類器なら head.dense) 並ぶ。"""
    names = sorted((k for k in init if k.startswith("onnx::MatMul_")), key=lambda s: int(s.split("_")[-1]))
    expected = [(HIDDEN, 3 * HIDDEN), (HIDDEN, HIDDEN), (HIDDEN, 2 * INTERMEDIATE), (INTERMEDIATE, HIDDEN)] * LAYERS
    if with_head:
        expected.append((HIDDEN, HIDDEN))
    shapes = [tuple(init[n].shape) for n in names]
    if shapes != expected:
        raise SystemExit(f"unexpected MatMul weight shapes: {shapes}")
    return names


def strip_prefix(name: str) -> str:
    """sentence-transformers の export (Ruri) は "0.auto_model." 付き、分類器は "model." 付き。どちらも外して揃える。"""
    for prefix in ("0.auto_model.", "model."):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert-cognitive-wgsl.py <model.onnx> <out.aqw>")
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    init = {strip_prefix(t.name): numpy_helper.to_array(t) for t in onnx.load(str(src)).graph.initializer}
    head = "classifier" if "classifier.weight" in init else "mean-pool"
    mm = matmul_weight_names(init, head == "classifier")

    tensors: list[tuple[str, str, list[int], bytes]] = []

    def f32(name: str, arr: np.ndarray) -> None:
        tensors.append((name, "f32", list(arr.shape), np.ascontiguousarray(arr, dtype="<f4").tobytes()))

    def f16_linear(name: str, w_in_out: np.ndarray) -> None:
        w = np.ascontiguousarray(w_in_out.T, dtype="<f2")  # [out, in]
        tensors.append((name, "f16", list(w.shape), w.tobytes()))

    f32("emb_norm", init["embeddings.norm.weight"])
    for layer in range(LAYERS):
        wqkv, wo, wi, wo2 = mm[4 * layer: 4 * layer + 4]
        if layer > 0:  # layer 0 の attn_norm は Identity
            f32(f"l{layer}.attn_norm", init[f"layers.{layer}.attn_norm.weight"])
        f16_linear(f"l{layer}.wqkv", init[wqkv])
        f16_linear(f"l{layer}.wo", init[wo])
        f32(f"l{layer}.mlp_norm", init[f"layers.{layer}.mlp_norm.weight"])
        f16_linear(f"l{layer}.wi", init[wi])
        f16_linear(f"l{layer}.wo2", init[wo2])
    f32("final_norm", init["final_norm.weight"])
    if head == "classifier":
        f16_linear("head_dense", init[mm[40]])
        f32("head_norm", init["head.norm.weight"])
        f32("cls_w", init["classifier.weight"])  # [9, 256]
        f32("cls_b", init["classifier.bias"])

    emb = init["embeddings.tok_embeddings.weight"].astype(np.float32)
    if emb.shape != (VOCAB, HIDDEN):
        raise SystemExit(f"unexpected embedding shape {emb.shape}")
    scale = np.abs(emb).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(emb / scale[:, None]), -127, 127).astype(np.int8)
    f32("emb_scale", scale.astype(np.float32))
    tensors.append(("emb_q", "i8", [VOCAB, HIDDEN], q.tobytes()))

    entries = []
    offset = 0
    for name, dtype, shape, data in tensors:
        if len(data) % 4:
            raise SystemExit(f"{name}: byte length {len(data)} is not 4-byte aligned")
        entries.append({"name": name, "dtype": dtype, "shape": shape, "offset": offset, "bytes": len(data)})
        offset += len(data)
    header = {
        "format": "aqw1",
        "config": {
            "hidden": HIDDEN, "layers": LAYERS, "heads": 4, "intermediate": INTERMEDIATE, "vocab": VOCAB,
            "localWindow": 128, "globalEvery": 3, "localRopeTheta": 10000.0, "globalRopeTheta": 160000.0,
            "normEps": 1e-5, "labels": LABELS if head == "classifier" else [],
        },
        "tensors": entries,
    }
    if head == "mean-pool":  # 分類器 (model.aqw) は head なし = classifier。既存ファイルと同じ byte 列を保つ
        header["config"]["head"] = head
    hjson = json.dumps(header, separators=(",", ":")).encode()
    hjson += b" " * (-len(hjson) % 4)
    with dst.open("wb") as f:
        f.write(b"AQW1")
        f.write(struct.pack("<I", len(hjson)))
        f.write(hjson)
        for _, _, _, data in tensors:
            f.write(data)
    print(f"wrote {dst} ({dst.stat().st_size} bytes, {len(entries)} tensors, head={head})")


if __name__ == "__main__":
    main()
