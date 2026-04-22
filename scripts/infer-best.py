#!/usr/bin/env python3
"""ベストモデル (docs/runs/20260422-022431-clean-jp-18k/epochs/17/model) で
実サンプルの Bluesky 投稿に対して cognitive per-post 推論をする CLI。

本番運用想定の処理パイプライン:
  1. preprocess_text (URL/hashtag/mention を除去、空白圧縮)
  2. 日本語比率 < 0.5 なら skip
  3. 長文 (>= threshold) は 括弧外 「。！？!?」で分割 → 各 piece を推論 →
     pieces の softmax を mean aggregate
  4. 短文はそのまま 1 回推論
  5. top-3 cognitive function と確率を出力

使い方:
  # 引数に文字列を渡す
  python scripts/infer-best.py "今日は何となく本質を捉えた気がする。"

  # 複数投稿をまとめて
  python scripts/infer-best.py "投稿1" "投稿2" "投稿3"

  # 標準入力から (1 行 1 投稿)
  cat posts.txt | python scripts/infer-best.py -

  # サンプル投稿集で動作確認
  python scripts/infer-best.py --demo
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoModelForSequenceClassification, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = REPO_ROOT / "docs/runs/20260422-022431-clean-jp-18k/epochs/17/model"

# finetune-soft-label.py の preprocess_text / has_japanese / split_long_post を流用
_spec = importlib.util.spec_from_file_location(
    "fsl", REPO_ROOT / "scripts/finetune-soft-label.py"
)
_fsl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fsl)

COGNITIVE = _fsl.COGNITIVE  # ["Ni","Ne","Si","Se","Ti","Te","Fi","Fe","none"]


def pick_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def load_model(model_dir: Path, device: torch.device):
    tok = AutoTokenizer.from_pretrained(str(model_dir))
    model = AutoModelForSequenceClassification.from_pretrained(str(model_dir))
    model.to(device).eval()
    return tok, model


@torch.no_grad()
def infer_pieces(pieces: list[str], tok, model, device, max_len: int = 256) -> np.ndarray:
    """pieces を 1 バッチで推論 → shape (n_pieces, 9) の softmax 確率を返す。"""
    enc = tok(pieces, padding=True, truncation=True, max_length=max_len, return_tensors="pt")
    enc = {k: v.to(device) for k, v in enc.items()}
    out = model(**enc)
    probs = F.softmax(out.logits, dim=-1).cpu().numpy()
    return probs


def classify_post(
    raw_text: str,
    tok,
    model,
    device,
    split_threshold: int = 120,
) -> dict:
    """1 post を推論して結果 dict を返す。

    split_threshold 字以上の日本語 post は 括弧外 「。！？!?」で分割し、
    全 piece の softmax を mean 集約した分布を「最終スコア」とする。
    """
    pre = _fsl.preprocess_text(raw_text)
    if len(pre) < 8:
        return {"raw": raw_text, "preprocessed": pre, "status": "too_short", "top": []}
    if not _fsl.has_japanese(pre):
        return {"raw": raw_text, "preprocessed": pre, "status": "not_japanese", "top": []}

    pieces = _fsl.split_long_post(pre, split_threshold)
    # split_long_post は元文を pieces[0] に含めるので、split されたかは len で判定
    split_used = len(pieces) > 1
    probs = infer_pieces(pieces, tok, model, device)
    whole_prob = probs[0]
    if split_used:
        # 元文 + 各 piece すべての softmax を mean (元文にも重みを残す)
        agg = probs.mean(axis=0)
    else:
        agg = whole_prob

    order = np.argsort(-agg)
    top3 = [(COGNITIVE[i], float(agg[i])) for i in order[:3]]
    return {
        "raw": raw_text,
        "preprocessed": pre,
        "status": "ok",
        "pieces": pieces,
        "piece_probs": probs.tolist(),
        "aggregated": {COGNITIVE[i]: float(agg[i]) for i in range(len(COGNITIVE))},
        "top": top3,
    }


def _fmt_probs(d: dict[str, float]) -> str:
    return "  ".join(f"{k}={v * 100:4.1f}" for k, v in d.items())


def print_result(r: dict, verbose: bool = False) -> None:
    print("=" * 80)
    print(f"INPUT: {r['raw']}")
    if r["status"] != "ok":
        print(f"  → [SKIP: {r['status']}] preprocessed='{r['preprocessed']}'")
        return
    pre = r["preprocessed"]
    print(f"PREPROCESSED: {pre}")
    if len(r["pieces"]) > 1:
        print(f"SPLIT INTO {len(r['pieces'])} pieces (incl. whole):")
        for i, p in enumerate(r["pieces"]):
            tag = "WHOLE" if i == 0 else f"PART{i}"
            probs = r["piece_probs"][i]
            order = sorted(range(len(COGNITIVE)), key=lambda j: -probs[j])
            top3 = "  ".join(f"{COGNITIVE[j]}={probs[j] * 100:.1f}" for j in order[:3])
            print(f"  [{tag}] {p}")
            print(f"         top3: {top3}")
    if verbose:
        print(f"AGGREGATED: {_fmt_probs(r['aggregated'])}")
    top = r["top"]
    print(f"TOP-3: {top[0][0]} ({top[0][1] * 100:.1f}%)  "
          f"{top[1][0]} ({top[1][1] * 100:.1f}%)  "
          f"{top[2][0]} ({top[2][1] * 100:.1f}%)")


DEMO_POSTS = [
    "毎日コツコツ書き続けてきた記録を見返すと、やっぱり継続は裏切らないなあとしみじみ思う。",
    "この議論のどこが本質的な論点なのか整理したい。まず定義を確認しよう。効率や結果ではなく、概念の整合性の話。",
    "今日も締切までにタスク片付けた！次は来週のリリース準備、優先度高い順にやっていく。",
    "あのチームの雰囲気、みんな元気そうで本当によかった。やっぱり空気って大事だよね。",
    "この一枚の写真から、未来のアートはこう変わるんじゃないかっていうビジョンがふと見えた気がする。",
    "自分が何を大切にしているのか、言葉にしてみると改めて腑に落ちる瞬間がある。",
    "たった今、目の前の夕焼けが信じられないくらい綺麗で、走って写真撮りに行った。",
    "この記事、ここからあの話にもつながるし、別の分野のあの研究ともリンクしそう。面白い。",
    "ごはん食べた。眠い。",
    "Just shipped a new feature, feels good.",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("texts", nargs="*", help="推論する投稿テキスト (複数可)。'-' で stdin から読む。")
    ap.add_argument("--demo", action="store_true", help="デモ投稿集で動作確認")
    ap.add_argument("--split-threshold", type=int, default=120,
                    help="この字数以上なら 句点分割 + mean aggregate (default 120)")
    ap.add_argument("--model-dir", type=str, default=str(MODEL_DIR))
    ap.add_argument("--verbose", action="store_true", help="集約 softmax 9 次元を全表示")
    args = ap.parse_args()

    texts: list[str] = []
    if args.demo:
        texts.extend(DEMO_POSTS)
    elif args.texts == ["-"]:
        texts.extend([l.strip() for l in sys.stdin if l.strip()])
    else:
        texts.extend(args.texts)

    if not texts:
        ap.print_help()
        sys.exit(1)

    device = pick_device()
    model_dir = Path(args.model_dir)
    if not model_dir.exists():
        print(f"ERROR: model dir not found: {model_dir}", file=sys.stderr)
        sys.exit(2)
    print(f"[info] loading model from {model_dir} on {device} ...")
    tok, model = load_model(model_dir, device)
    print(f"[info] labels: {COGNITIVE}")
    print(f"[info] N posts: {len(texts)}")
    print()

    for t in texts:
        r = classify_post(t, tok, model, device, split_threshold=args.split_threshold)
        print_result(r, verbose=args.verbose)
    print("=" * 80)


if __name__ == "__main__":
    main()
