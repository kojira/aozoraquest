#!/usr/bin/env python3
"""Ruri-v3-30m を Gemini ラベルで classification fine-tune + ONNX export。

入力: docs/data/cognitive-labeled-gemini.jsonl
出力:
  - docs/data/ruri-finetuned/ (fine-tuned HF model + tokenizer)
  - docs/data/ruri-finetuned-onnx/ (int8 quantized ONNX for transformers.js)

手法:
  1. cl-nagoya/ruri-v3-30m をベースに AutoModelForSequenceClassification (8クラス)
  2. クラスバランス: 多数派クラスをダウンサンプルして全クラスを target 件数に揃える
  3. HF Trainer で cross-entropy 学習 (MPS = Apple GPU)
  4. 学習後 encoder だけ保存
  5. optimum-cli で int8 ONNX export

使い方:
  python3 scripts/finetune-ruri.py [--epochs 3] [--per-class 300] [--batch 16]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import torch
from datasets import Dataset
from transformers import (
    AutoModel,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_MODEL = "cl-nagoya/ruri-v3-30m"
DATA_FILE = REPO_ROOT / "docs/data/cognitive-labeled-gemini.jsonl"
HELD_OUT_TEST = REPO_ROOT / "docs/data/cognitive-split/test.jsonl"  # eval で使うので train から除外
OUT_DIR = REPO_ROOT / "docs/data/ruri-finetuned"
ENC_DIR = REPO_ROOT / "docs/data/ruri-finetuned-encoder"

LABELS = ["Ni", "Ne", "Si", "Se", "Ti", "Te", "Fi", "Fe"]
LABEL2ID = {l: i for i, l in enumerate(LABELS)}
ID2LABEL = {i: l for i, l in enumerate(LABELS)}


def _key(obj: dict) -> str:
    return f"{obj.get('did', '')}|{obj.get('at', '')}|{obj.get('text', '')[:40]}"


def load_examples() -> tuple[list[dict], set[str], list[dict]]:
    """全ラベル付きデータを読み、test.jsonl と一致するものは train から除外して
    (train_candidates, test_keys, test_examples) を返す。"""
    test_keys: set[str] = set()
    test_examples: list[dict] = []
    if HELD_OUT_TEST.exists():
        with HELD_OUT_TEST.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                test_keys.add(_key(obj))
                top1 = obj.get("geminiRanked", [None])[0]
                if top1 in LABEL2ID:
                    test_examples.append({"text": obj["text"], "label": LABEL2ID[top1]})
    print(f"[info] held-out test: {len(test_examples)} 件")

    examples: list[dict] = []
    with DATA_FILE.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if _key(obj) in test_keys:
                continue  # test set は除外
            top1 = obj.get("geminiRanked", [None])[0]
            if top1 not in LABEL2ID:
                continue
            examples.append({"text": obj["text"], "label": LABEL2ID[top1]})
    return examples, test_keys, test_examples


def balance(examples: list[dict], per_class: int, seed: int = 42) -> list[dict]:
    random.seed(seed)
    by_class: dict[int, list[dict]] = defaultdict(list)
    for e in examples:
        by_class[e["label"]].append(e)
    balanced: list[dict] = []
    for label in sorted(by_class.keys()):
        items = by_class[label]
        if len(items) >= per_class:
            balanced.extend(random.sample(items, per_class))
        else:
            # 少数派クラスは oversample (重複で水増し)
            mult = per_class // len(items)
            rem = per_class - mult * len(items)
            balanced.extend(items * mult + random.sample(items, rem))
    random.shuffle(balanced)
    return balanced


def train_val_split(examples: list[dict], val_ratio: float = 0.1, seed: int = 42) -> tuple[list[dict], list[dict]]:
    random.seed(seed)
    by_class: dict[int, list[dict]] = defaultdict(list)
    for e in examples:
        by_class[e["label"]].append(e)
    train: list[dict] = []
    val: list[dict] = []
    for label, items in by_class.items():
        random.shuffle(items)
        n_val = max(1, int(len(items) * val_ratio))
        val.extend(items[:n_val])
        train.extend(items[n_val:])
    random.shuffle(train)
    random.shuffle(val)
    return train, val


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {"accuracy": float((preds == labels).mean())}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--per-class", type=int, default=300)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--max-len", type=int, default=128)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = ap.parse_args()

    print(f"[info] device={args.device}, base={BASE_MODEL}")
    print(f"[info] data={DATA_FILE}")

    examples, _, test_examples = load_examples()
    print(f"[info] 読み込み: {len(examples)} 件 (train 候補, test set は除外済み)")
    dist = Counter(e["label"] for e in examples)
    print(f"[info] 自然分布: { {LABELS[i]: dist[i] for i in sorted(dist)} }")

    balanced = balance(examples, per_class=args.per_class)
    print(f"[info] balanced: {len(balanced)} 件 (per_class={args.per_class})")
    train, val = train_val_split(balanced, val_ratio=0.1)
    print(f"[info] train={len(train)}, val={len(val)}")

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(
        BASE_MODEL,
        num_labels=len(LABELS),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )

    def tok(batch):
        return tokenizer(batch["text"], padding="max_length", truncation=True, max_length=args.max_len)

    train_ds = Dataset.from_list(train).map(tok, batched=True)
    val_ds = Dataset.from_list(val).map(tok, batched=True)

    t_args = TrainingArguments(
        output_dir=str(OUT_DIR),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        learning_rate=args.lr,
        warmup_ratio=0.1,
        weight_decay=0.01,
        logging_steps=50,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        greater_is_better=True,
        save_total_limit=2,
        report_to=[],
        fp16=False,  # MPS で fp16 は BERT 系で不安定
        use_mps_device=(args.device == "mps"),
    )

    trainer = Trainer(
        model=model,
        args=t_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tokenizer,
        compute_metrics=compute_metrics,
    )
    print("[info] 学習開始...")
    trainer.train()
    print("[info] 学習完了")

    metrics = trainer.evaluate()
    print(f"[info] val metrics (balanced val subset): {metrics}")

    # 保留 test set での評価 (自然分布 249 件、従来の線形 classifier 比較用)
    if test_examples:
        test_ds = Dataset.from_list(test_examples).map(tok, batched=True)
        preds_out = trainer.predict(test_ds)
        preds = np.argmax(preds_out.predictions, axis=-1)
        gold = np.array([e["label"] for e in test_examples])
        test_acc = float((preds == gold).mean())
        top3 = np.argsort(preds_out.predictions, axis=-1)[:, ::-1][:, :3]
        print(f"[info] 保留 test ({len(test_examples)} 件): top-1 acc = {test_acc * 100:.1f}%")
        # per-class summary
        per_class: dict[int, tuple[int, int]] = {}  # label -> (correct, total)
        for p, g in zip(preds, gold):
            c, t = per_class.get(g, (0, 0))
            per_class[g] = (c + int(p == g), t + 1)
        print("[info] per-class 正答率:")
        for lbl_idx in sorted(per_class.keys()):
            c, t = per_class[lbl_idx]
            print(f"         {LABELS[lbl_idx]}  {c}/{t} = {c / max(1, t) * 100:.1f}%")

    # 保存: 分類ヘッド付きモデル
    trainer.save_model(str(OUT_DIR))
    tokenizer.save_pretrained(str(OUT_DIR))
    print(f"[info] 分類モデル保存: {OUT_DIR}")

    # encoder のみも保存 (feature-extraction 用、ONNX export でこちらを使う)
    encoder = AutoModel.from_pretrained(str(OUT_DIR))  # head は drop される
    encoder.save_pretrained(str(ENC_DIR))
    tokenizer.save_pretrained(str(ENC_DIR))
    print(f"[info] encoder のみ保存: {ENC_DIR}")

    print("\n次のコマンドで ONNX + int8 export:")
    print(f"  optimum-cli export onnx --model {ENC_DIR} --task feature-extraction docs/data/ruri-finetuned-onnx")
    print(f"  # さらに int8 量子化:")
    print(f"  python3 scripts/quantize-onnx.py")


if __name__ == "__main__":
    main()
