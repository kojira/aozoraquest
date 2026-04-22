#!/usr/bin/env python3
"""ブラウザでの推論 latency 計測用の bench asset を用意する。

1. test_clean_jp.jsonl から N 件サンプリング、tokenize して固定長 (max_len) の
   input_ids / attention_mask を JSON に書き出す (JS 側は tokenize しない)
2. docs/runs/.../onnx-{fp32,int8,int4}/model.onnx を docs/bench/models/ に symlink
3. 静的ファイルサーバで docs/bench をサーブすれば browser bench が走る
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import random
from pathlib import Path

import numpy as np
from transformers import AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE = REPO_ROOT / "docs/runs/20260422-022431-clean-jp-18k/epochs/17"
PT_MODEL = BASE / "model"
TEST_FILE = REPO_ROOT / "docs/data/cognitive-split/test_clean_jp.jsonl"
BENCH_DIR = REPO_ROOT / "docs/bench"
MODELS_DIR = BENCH_DIR / "models"

_spec = importlib.util.spec_from_file_location(
    "fsl", REPO_ROOT / "scripts/finetune-soft-label.py"
)
_fsl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fsl)

COGNITIVE = _fsl.COGNITIVE
LABEL2ID = {c: i for i, c in enumerate(COGNITIVE)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50, help="bench に使うサンプル数")
    ap.add_argument("--max-len", type=int, default=128,
                    help="固定 padding 長 (Python bench は 256 だが browser は軽め)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    items: list[dict] = []
    with TEST_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            ranked = obj.get("geminiRanked", [])
            if not ranked or ranked[0] not in LABEL2ID:
                continue
            t = _fsl.preprocess_text(obj.get("text", ""))
            if len(t) < 8 or not _fsl.has_japanese(t):
                continue
            items.append({"text": t, "label": LABEL2ID[ranked[0]]})

    rng.shuffle(items)
    sample = items[:args.n]
    print(f"[info] sampled {len(sample)}/{len(items)} test items")

    tok = AutoTokenizer.from_pretrained(str(PT_MODEL))
    enc = tok([e["text"] for e in sample], padding="max_length",
              truncation=True, max_length=args.max_len, return_tensors="np")

    samples_out = []
    for i, e in enumerate(sample):
        samples_out.append({
            "text": e["text"],
            "label": e["label"],
            "input_ids": enc["input_ids"][i].astype(np.int64).tolist(),
            "attention_mask": enc["attention_mask"][i].astype(np.int64).tolist(),
        })

    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    meta = {
        "labels": COGNITIVE,
        "max_len": args.max_len,
        "n_samples": len(samples_out),
        "model_paths": {
            "fp32": "models/fp32.onnx",
            "int8": "models/int8.onnx",
            "int4": "models/int4.onnx",
        },
    }
    (BENCH_DIR / "samples.json").write_text(
        json.dumps({"meta": meta, "samples": samples_out}, ensure_ascii=False))
    print(f"[info] wrote {BENCH_DIR / 'samples.json'}")

    for tag, src_name in [("fp32", "onnx-fp32"), ("int8", "onnx-int8"), ("int4", "onnx-int4")]:
        src = (BASE / src_name / "model.onnx").resolve()
        dst = MODELS_DIR / f"{tag}.onnx"
        if dst.exists() or dst.is_symlink():
            dst.unlink()
        os.symlink(src, dst)
        sz = src.stat().st_size / 1024 / 1024
        print(f"[info] symlink {dst.name} → {src} ({sz:.1f} MB)")


if __name__ == "__main__":
    main()
