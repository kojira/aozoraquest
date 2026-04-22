#!/usr/bin/env python3
"""fp32 / int8 / int4 ONNX モデルの test 精度・速度を比較する。

test_clean_jp.jsonl (252 件、training 時と同じ preprocess/has_japanese filter) で
top-1 accuracy、macro F1、inference 平均 latency、モデルサイズを測る。

ベースライン (PyTorch fp32) との diff も出す。
"""

from __future__ import annotations

import importlib.util
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import torch.nn.functional as F
from sklearn.metrics import f1_score
from transformers import AutoModelForSequenceClassification, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE = REPO_ROOT / "docs/runs/20260422-022431-clean-jp-18k/epochs/17"
PT_MODEL = BASE / "model"
TEST_FILE = REPO_ROOT / "docs/data/cognitive-split/test_clean_jp.jsonl"

_spec = importlib.util.spec_from_file_location(
    "fsl", REPO_ROOT / "scripts/finetune-soft-label.py"
)
_fsl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fsl)

COGNITIVE = _fsl.COGNITIVE
LABEL2ID = {c: i for i, c in enumerate(COGNITIVE)}
MAX_LEN = 256


def load_test() -> list[dict]:
    items: list[dict] = []
    with TEST_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            ranked = obj.get("geminiRanked", [])
            if not ranked:
                continue
            top1 = ranked[0]
            if top1 not in LABEL2ID:
                continue
            t = _fsl.preprocess_text(obj.get("text", ""))
            if len(t) < 8:
                continue
            if not _fsl.has_japanese(t):
                continue
            items.append({"text": t, "label": LABEL2ID[top1]})
    return items


def run_pytorch(items: list[dict], tok) -> tuple[np.ndarray, float]:
    device = torch.device("cpu")  # CPU で公平比較
    model = AutoModelForSequenceClassification.from_pretrained(str(PT_MODEL))
    model.to(device).eval()
    preds = []
    t0 = time.time()
    with torch.no_grad():
        for e in items:
            enc = tok(e["text"], padding=True, truncation=True,
                      max_length=MAX_LEN, return_tensors="pt")
            enc = {k: v.to(device) for k, v in enc.items()}
            logits = model(**enc).logits
            preds.append(int(F.softmax(logits, dim=-1).argmax(dim=-1).item()))
    dt = time.time() - t0
    return np.array(preds), dt / len(items) * 1000  # ms/sample


def run_onnx(path: Path, items: list[dict], tok) -> tuple[np.ndarray, float]:
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    preds = []
    t0 = time.time()
    for e in items:
        enc = tok(e["text"], padding=True, truncation=True,
                  max_length=MAX_LEN, return_tensors="np")
        feeds = {
            "input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64),
        }
        logits = sess.run(None, feeds)[0]
        preds.append(int(np.argmax(logits, axis=-1)[0]))
    dt = time.time() - t0
    return np.array(preds), dt / len(items) * 1000


def summarize(name: str, preds: np.ndarray, golds: np.ndarray, ms: float, size_mb: float) -> dict:
    acc = float((preds == golds).mean())
    macro_f1 = float(f1_score(golds, preds, average="macro", zero_division=0))
    per_class_f1 = f1_score(golds, preds, average=None, labels=list(range(len(COGNITIVE))), zero_division=0)
    return {
        "name": name,
        "acc": acc,
        "macro_f1": macro_f1,
        "per_class_f1": {c: float(per_class_f1[i]) for i, c in enumerate(COGNITIVE)},
        "ms_per_sample": ms,
        "size_mb": size_mb,
    }


def main() -> None:
    items = load_test()
    golds = np.array([e["label"] for e in items])
    print(f"[info] test items: {len(items)}")
    print(f"[info] gold dist: " + ", ".join(
        f"{c}={int((golds == i).sum())}" for i, c in enumerate(COGNITIVE)
    ))

    tok = AutoTokenizer.from_pretrained(str(PT_MODEL))

    results: list[dict] = []

    # PyTorch baseline
    pt_size = (PT_MODEL / "model.safetensors").stat().st_size / 1024 / 1024
    print("\n[run] PyTorch fp32 (CPU) ...")
    pt_preds, pt_ms = run_pytorch(items, tok)
    results.append(summarize("PyTorch fp32", pt_preds, golds, pt_ms, pt_size))
    print(f"  acc={results[-1]['acc'] * 100:.2f}%  macroF1={results[-1]['macro_f1'] * 100:.2f}%  "
          f"{pt_ms:.1f} ms/sample  {pt_size:.1f} MB")

    for tag in ["onnx-fp32", "onnx-int8", "onnx-int4"]:
        p = BASE / tag / "model.onnx"
        if not p.exists():
            print(f"[skip] {p} not found")
            continue
        sz = p.stat().st_size / 1024 / 1024
        print(f"\n[run] {tag} (CPU) ...")
        preds, ms = run_onnx(p, items, tok)
        results.append(summarize(tag, preds, golds, ms, sz))
        r = results[-1]
        diff = (r["acc"] - results[0]["acc"]) * 100
        print(f"  acc={r['acc'] * 100:.2f}% (Δ{diff:+.2f}pt)  "
              f"macroF1={r['macro_f1'] * 100:.2f}%  "
              f"{ms:.1f} ms/sample  {sz:.1f} MB")

    print("\n=== SUMMARY ===")
    print(f"{'model':<18}{'acc':>8}{'macroF1':>10}{'ms/sample':>12}{'size':>10}")
    for r in results:
        print(f"{r['name']:<18}{r['acc'] * 100:>7.2f}%"
              f"{r['macro_f1'] * 100:>9.2f}%"
              f"{r['ms_per_sample']:>11.1f}ms"
              f"{r['size_mb']:>9.1f}MB")

    print("\n=== per-class F1 (%) ===")
    header = f"{'class':<6}" + "".join(f"{r['name']:>16}" for r in results)
    print(header)
    for c in COGNITIVE:
        row = f"{c:<6}" + "".join(f"{r['per_class_f1'][c] * 100:>15.1f} " for r in results)
        print(row)

    out = BASE / "onnx-compare.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"\n[info] saved: {out}")


if __name__ == "__main__":
    main()
