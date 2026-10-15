# Issue #777: Gemini Nano の無い端末で 投稿翻訳を 端末内 sarashina2.2-0.5b で動かす

オーナー承認 (2026-10-15)。検討メモ (試作・実測) は repo 外 `~/.pi/slm-wgsl/design-sarashina-app.md` と `report.md`。

## 決定事項
- Nano のある PC は変えない。`BACKENDS = [GEMINI_NANO, SARASHINA]` で Nano が先。
- sarashina は **翻訳だけ** (`LocalLLM.purposes = ['translation']`)。召喚の口上・カード文は従来どおり `'general'` で Nano のみ。
  `pickLocalLLM(force, purpose)` は用途ごとに memoize する。
- 対象端末: `detectGeminiNano() === 'unavailable'` かつ `navigator.gpu` あり。翻訳 UI・文言・設定は PC と同じ。
- 導入 (初回 約 430MB) は召喚の儀式中だけ: `SummoningRitual` が `installSarashina()` を並行で始め、greeting の待ちで完了を待つ。
  失敗しても手書きの口上で完走する (翻訳は未導入のまま、次の儀式でやり直す)。`availability()` は導入済みの時だけ true なので、
  未導入の端末では翻訳 UI は今と同じく出ない。
- 翻訳が必要になった時点で未導入の場合のダウンロード (要件 b) は保留中 (オーナー判断待ち)。この PR には入れない。
- 儀式の見た目は全面的に作り直し、PC の儀式も同じ新しい見た目になる (文言・流れ・PC の LLM 口上は不変)。数値の進捗は出さない。

## 構成
- `src/lib/slm-wgsl/`: `kernels.ts` / `model.ts` (試作の Llama 経路だけ: int4 g32 matmul、RMSNorm、RoPE、GQA、f16 KV cache、SwiGLU、
  GPU top-K)、`sptok.ts` (SentencePiece Unigram + byte fallback)、`weights.ts` (part ごとに fetch → sha256 照合 → Cache → GPU)。
- `src/lib/slm.worker.ts`: 推論専用 Worker。`src/lib/sarashina-llm.ts`: LocalLLM 実装、最後の生成から 3 分 / pagehide で解放、device lost で作り直し。
- `src/lib/sarashina-translate.ts`: system 1 行 + few-shot 4 往復、最初の改行で停止、段落ごとに翻訳、ラテン文字を含む括弧書き (語釈) を除去。
  その後は既存の `cleanTranslation` / 日本語比率判定 / 温度リトライ / IDB キャッシュをそのまま通る。
- `src/components/ritual-stage.tsx` + `styles/summon-ritual.css`: 儀式の見た目 (transform / opacity のみのアニメーション)。
- 重み: HF `kojira/aozoraquest-cognitive-small` の `wgsl/sarashina2.2-0.5b-q4/` (commit `5770ffdd050e24172b17f5bce878eccd8c731aa6` 固定)。
  `header.json` + `part-000..013.bin` (32MB) + `tokenizer.json` + `LICENSE` (MIT, SB Intuitions) + `README.md`。

## 実装中に分かったこと
- `Math.min(...scores)` (語彙 102400 件) は Worker のスタックで RangeError になる。ループで最小値を取る。
- HF の `LlamaTokenizer` (transformers) の分割は sentencepiece 本体と英語で異なる。期待 id は sentencepiece 本体で作り、
  WGSL の parity (HF int4 参照) は試作で同じ sptok を使って一致している。

## 検証
- parity (手元 WebGPU、HF int4 fake-quant 参照、3 プロンプト): top-1 100% / 100% / 100%、greedy 30 tok 一致 (2 本目は 11 tok + EOS で一致)。
- unit: `slm-wgsl/sptok.test.ts` (8 文)、`sarashina-translate.test.ts`、`local-llm.test.ts`。
- E2E (手元のみ、`AQ_SARASHINA_LOCAL_DIR`): `e2e/sarashina-translation.spec.ts`。CI では重みが無いので skip。
- 実機 (iPhone / Android) はオーナー確認。
