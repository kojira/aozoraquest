#!/usr/bin/env python3
"""fine-tuned Ruri モデル + 分類 head で per-user 評価。

user-labels-gemini.jsonl (Gemini archetype 判定) に対し、
- 各ユーザーの 30 投稿を fine-tuned Ruri に通して cognitive softmax を計算
- 30 件の softmax を平均 → cognitive 分布
- determineArchetype (気質スタック適合度 argmax) で archetype を導出
- Gemini primary と比較して per-user accuracy を算出

HTML レポートも出力。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parent.parent

LABELS = ["Ni", "Ne", "Si", "Se", "Ti", "Te", "Fi", "Fe"]

# 16 archetype 定義 (packages/core/src/jobs.ts から転記)
ARCHETYPES: list[tuple[str, str, str, str]] = [
    # (id, name, dom, aux)
    ("sage", "賢者", "Ni", "Te"),
    ("mage", "魔法使い", "Ti", "Ne"),
    ("shogun", "将軍", "Te", "Ni"),
    ("bard", "吟遊詩人", "Ne", "Ti"),
    ("seer", "予言者", "Ni", "Fe"),
    ("poet", "詩人", "Fi", "Ne"),
    ("paladin", "聖騎士", "Fe", "Ni"),
    ("explorer", "冒険者", "Ne", "Fi"),
    ("warrior", "戦士", "Si", "Te"),
    ("guardian", "守護者", "Si", "Fe"),
    ("fighter", "武闘家", "Ti", "Se"),
    ("artist", "芸術家", "Fi", "Se"),
    ("captain", "隊長", "Te", "Si"),
    ("miko", "巫女", "Fe", "Si"),
    ("ninja", "忍者", "Se", "Ti"),
    ("performer", "遊び人", "Se", "Fi"),
]

# tuning.ARCHETYPE_FIT_WEIGHTS
W_DOM, W_AUX, W_TERT, W_INF = 1.0, 0.7, 0.3, 0.1

OPPOSITE_LETTER = {"N": "S", "S": "N", "T": "F", "F": "T"}
OPPOSITE_ATTITUDE = {"i": "e", "e": "i"}


def temperament_stack(dom: str, aux: str) -> tuple[str, str]:
    tertiary = OPPOSITE_LETTER[aux[0]] + dom[1]
    inferior = OPPOSITE_LETTER[dom[0]] + OPPOSITE_ATTITUDE[dom[1]]
    return tertiary, inferior


def determine_archetype(scores: dict[str, float]) -> str:
    """argmax over 16 archetypes via MBTI-style stack fit."""
    best_id = ARCHETYPES[0][0]
    best_fit = -1e18
    for aid, _name, dom, aux in ARCHETYPES:
        tert, inf = temperament_stack(dom, aux)
        fit = (
            W_DOM * scores.get(dom, 0)
            + W_AUX * scores.get(aux, 0)
            + W_TERT * scores.get(tert, 0)
            + W_INF * scores.get(inf, 0)
        )
        if fit > best_fit:
            best_fit = fit
            best_id = aid
    return best_id


def archetype_name(aid: str) -> str:
    for x in ARCHETYPES:
        if x[0] == aid:
            return x[1]
    return aid


def esc(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;").replace("'", "&#39;"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(REPO_ROOT / "docs/data/ruri-finetuned"))
    ap.add_argument("--users", default=str(REPO_ROOT / "docs/data/user-labels-gemini.jsonl"))
    ap.add_argument("--html", default=str(REPO_ROOT / "docs/logs/eval-user-finetuned.html"))
    ap.add_argument("--max-len", type=int, default=128)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    args = ap.parse_args()

    print(f"[info] model={args.model}")
    print(f"[info] users={args.users}")
    print(f"[info] device={args.device}\n")

    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model).to(args.device).eval()

    users: list[dict] = []
    with open(args.users) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            users.append(json.loads(line))
    print(f"[info] users={len(users)}\n")

    # id2label 取得 (モデルに保存された idx -> label)
    id2label = model.config.id2label
    label_order = [id2label[i] for i in range(len(id2label))]
    print(f"[info] label order: {label_order}")

    rows: list[dict] = []
    correct = 0
    for i, u in enumerate(users):
        handle = u["handle"]
        posts = u["posts"]
        # バッチ推論
        all_probs = []
        for b in range(0, len(posts), args.batch):
            batch_texts = posts[b:b + args.batch]
            inputs = tokenizer(batch_texts, padding="max_length", truncation=True,
                               max_length=args.max_len, return_tensors="pt").to(args.device)
            with torch.no_grad():
                out = model(**inputs)
            probs = torch.softmax(out.logits, dim=-1).cpu().numpy()
            all_probs.append(probs)
        all_probs = np.concatenate(all_probs, axis=0)  # (N, K)
        avg = all_probs.mean(axis=0)  # (K,)

        # cognitive スコア 0-100 スケール
        scores = {label_order[j]: float(avg[j] * 100) for j in range(len(label_order))}
        pred_arch = determine_archetype(scores)
        gold = u["geminiPrimary"]
        ok = pred_arch == gold
        if ok: correct += 1

        # ruri top-3 cognitive
        ranked = sorted(scores.items(), key=lambda x: -x[1])
        ruri_top3 = [k for k, _ in ranked[:3]]

        rows.append({
            "handle": handle,
            "gold": gold,
            "pred": pred_arch,
            "goldTop3Cog": u.get("geminiTop3Cog", []),
            "predTop3Cog": ruri_top3,
            "geminiConfidence": u.get("geminiConfidence", ""),
            "reasoning": u.get("geminiReasoning", ""),
            "correct": ok,
            "scores": scores,
        })
        mark = "✓" if ok else "✗"
        print(f"[{i+1}/{len(users)}] @{handle}  gold={gold}  pred={pred_arch}  {mark}")

    acc = correct / max(1, len(rows))
    print(f"\n=== per-user accuracy: {correct}/{len(rows)} = {acc * 100:.1f}% ===")

    # HTML
    Path(args.html).parent.mkdir(parents=True, exist_ok=True)
    row_html = ""
    for r in rows:
        cls = "ok" if r["correct"] else "ng"
        mark = "✓" if r["correct"] else "✗"
        row_html += f"""
        <tr class="{cls}">
          <td>{mark}</td>
          <td><a href="https://bsky.app/profile/{esc(r['handle'])}" target="_blank">@{esc(r['handle'])}</a></td>
          <td>{esc(archetype_name(r['gold']))} <span class="id">({esc(r['gold'])})</span></td>
          <td>{esc(archetype_name(r['pred']))} <span class="id">({esc(r['pred'])})</span></td>
          <td class="mono">{esc(",".join(r["goldTop3Cog"]))}</td>
          <td class="mono">{esc(",".join(r["predTop3Cog"]))}</td>
          <td>{esc(r["geminiConfidence"])}</td>
          <td class="reason">{esc(r["reasoning"][:200])}{"…" if len(r["reasoning"]) > 200 else ""}</td>
        </tr>"""

    # pair 集計
    pairs: dict[tuple[str, str], int] = {}
    for r in rows:
        pairs[(r["gold"], r["pred"])] = pairs.get((r["gold"], r["pred"]), 0) + 1
    pairs_sorted = sorted(pairs.items(), key=lambda x: -x[1])
    pair_html = ""
    for (g, p), n in pairs_sorted:
        cls = "ok" if g == p else "ng"
        pair_html += f"""
        <tr class="{cls}">
          <td>{'✓' if g == p else ''}</td>
          <td>{esc(archetype_name(g))} <span class="id">({esc(g)})</span></td>
          <td>{esc(archetype_name(p))} <span class="id">({esc(p)})</span></td>
          <td>{n}</td>
        </tr>"""

    html = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>per-user fine-tuned eval</title><style>
body{{font-family:"Hiragino Maru Gothic ProN","Noto Sans JP",sans-serif;margin:2em;background:#f6f9fc;color:#1c2b44}}
.summary{{background:white;border:2px solid #9fd7ff;border-radius:6px;padding:1em 1.2em;margin:1em 0;display:flex;gap:2em}}
.metric .value{{font-size:2em;font-weight:700;font-family:ui-monospace,monospace;color:#1c5299}}
.metric .label{{color:#546580;font-size:.85em}}
table{{width:100%;border-collapse:collapse;background:white;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:1.5em;overflow:hidden}}
th,td{{padding:.5em .75em;text-align:left;border-bottom:1px solid #e0eaf5;font-size:.9em;vertical-align:top}}
th{{background:#eef4fb}}
tr.ok{{background:rgba(60,180,100,.06)}}
tr.ng{{background:rgba(220,100,100,.06)}}
.id{{color:#888;font-size:.85em}}
.mono{{font-family:ui-monospace,monospace}}
.reason{{max-width:40em;font-size:.8em;color:#546580}}
</style></head><body>
<h1>per-user fine-tuned eval</h1>
<p>model: {esc(args.model)}</p>
<div class="summary">
<div class="metric"><div class="value">{acc*100:.1f}%</div><div class="label">per-user accuracy ({correct}/{len(rows)})</div></div>
</div>
<h2>archetype pair 集計</h2>
<table><thead><tr><th></th><th>Gemini (gold)</th><th>Ruri (pred)</th><th>n</th></tr></thead>
<tbody>{pair_html}</tbody></table>
<h2>全ユーザー</h2>
<table><thead><tr><th></th><th>user</th><th>Gemini</th><th>Ruri pred</th><th>Gemini cog top3</th><th>Ruri cog top3</th><th>conf</th><th>Gemini reasoning</th></tr></thead>
<tbody>{row_html}</tbody></table>
</body></html>"""
    with open(args.html, "w") as f:
        f.write(html)
    print(f"HTML: {args.html}")


if __name__ == "__main__":
    main()
