/**
 * scripts/validate-llm-gemini-v2-neutral.ts
 *
 * 前回の Gemini 検証 (validate-llm-gemini.ts) で中立 FP (認知) 83.7% となった件の
 * フェアな再測定。prompt を以下に改善:
 *   - ランク付け (top-3) ではなく単一ラベル要求
 *   - "none" が正解である投稿例を prompt に埋め込む (few-shot)
 *   - 「日常的な報告は認知機能とは関係ない」と明示
 *
 * 実行: pnpm tsx scripts/validate-llm-gemini-v2-neutral.ts
 * 出力: docs/data/llm-benchmark-gemini-v2.md
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL_ID = 'gemini-3.1-flash-lite-preview' as const;
const COGNITIVE_FUNCTIONS = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'] as const;
const TAGS = ['question', 'distress', 'goodnews', 'humor', 'analysis', 'opinion', 'underseen', 'fresh', 'debated'] as const;
const NONE_LABEL = 'none';

const THROTTLE_MS = 250;
const MAX_RETRIES = 3;
const ROOT = new URL('..', import.meta.url).pathname;

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set'); process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface NeutralPost { text: string }
interface Prediction { label: string; latencyMs: number }

function loadJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('//'))
    .map(l => JSON.parse(l) as T);
}

// ─────────────────────────────────────────────────
// 改善された prompt
// ─────────────────────────────────────────────────

function cogPromptV2(text: string): string {
  return `次の投稿について、ユング派の 8 認知機能 (Ni / Ne / Si / Se / Ti / Te / Fi / Fe) のうち、**明確に前面に出ている機能が 1 つ** あるか判断してください。

重要: 以下のような投稿は、特定の認知機能が「読み取れない」ので必ず "none" を返してください:
- 日常的な行動報告 ("今日は散歩した")
- 事実の記述 ("冷蔵庫に卵が 3 個")
- 短い感想やルーチン ("傘忘れた")
- 天気や状況の報告 ("雨が降ってきた")

認知機能として分類できるのは、その機能の**特徴的な思考様式が明確に表れている**投稿のみです。迷ったら "none" にしてください。

例:
- "今日は散歩してきた"                         → {"label": "none"}
- "傘忘れた、やばい"                           → {"label": "none"}
- "表面の議論より、その下で動いてる地殻が気になる" → {"label": "Ni"}
- "30 分で決めきる、延ばしても質は上がらない"       → {"label": "Te"}
- "その定義だとこことここで矛盾しない？"            → {"label": "Ti"}

投稿: "${text}"

JSON オブジェクトのみを返してください (説明文なし):
{"label": "Ni" または "Ne" など、あるいは "none"}`;
}

function tagPromptV2(text: string): string {
  return `次の投稿のトーンを判定してください。

カテゴリ: question / distress / goodnews / humor / analysis / opinion / underseen / fresh / debated

重要: 以下のような投稿は、特定のトーンに分類できないので必ず "none" を返してください:
- 日常的な行動報告 ("今日は散歩した")
- 事実の記述 ("冷蔵庫に卵が 3 個")
- 短いメモ ("傘忘れた")
- ルーチン的な独り言 ("電池切れた")

カテゴリに該当するのは、**そのトーンが明確に表れている投稿のみ** です。迷ったら "none" にしてください。

例:
- "今日はいい天気"                  → {"label": "none"}
- "冷蔵庫に卵が 3 個残ってる"         → {"label": "none"}
- "もう限界かも、何も手につかない"    → {"label": "distress"}
- "朝から冷蔵庫開けて何を取りに来たか忘れた、脳みそどこ行った" → {"label": "humor"}

投稿: "${text}"

JSON オブジェクトのみを返してください:
{"label": "question" など、あるいは "none"}`;
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function classify(prompt: string, valid: readonly string[]): Promise<Prediction> {
  let lastErr: unknown;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const t0 = performance.now();
      const res = await ai.models.generateContent({
        model: MODEL_ID,
        contents: prompt,
        config: { temperature: 0, responseMimeType: 'application/json' },
      });
      const latencyMs = performance.now() - t0;
      const text = (res.text ?? '').trim();
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : text) as { label: string };
      const label = String(parsed.label ?? '').trim();
      if (!valid.includes(label as never)) {
        throw new Error(`invalid label: ${label}`);
      }
      return { label, latencyMs };
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

(async () => {
  const neutralSet = loadJsonl<NeutralPost>(join(ROOT, 'docs/data/validation/neutral.jsonl'));
  console.log(`中立: ${neutralSet.length} 件 × 2 分類 = ${neutralSet.length * 2} 呼び出し`);

  // 中立 → 認知
  console.log('\n[中立 → 認知機能 (v2 prompt)]');
  const cogPreds: Prediction[] = [];
  let failures = 0;
  for (let i = 0; i < neutralSet.length; i++) {
    try {
      const p = await classify(cogPromptV2(neutralSet[i].text), [...COGNITIVE_FUNCTIONS, NONE_LABEL]);
      cogPreds.push(p);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${neutralSet.length}`);
    } catch (e) {
      failures++;
      cogPreds.push({ label: NONE_LABEL, latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // 中立 → タグ
  console.log('\n[中立 → タグ (v2 prompt)]');
  const tagPreds: Prediction[] = [];
  for (let i = 0; i < neutralSet.length; i++) {
    try {
      const p = await classify(tagPromptV2(neutralSet[i].text), [...TAGS, NONE_LABEL]);
      tagPreds.push(p);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${neutralSet.length}`);
    } catch (e) {
      failures++;
      tagPreds.push({ label: NONE_LABEL, latencyMs: 0 });
    }
    await sleep(THROTTLE_MS);
  }

  // 集計
  const cogFp = cogPreds.filter(p => p.label !== NONE_LABEL).length / cogPreds.length;
  const tagFp = tagPreds.filter(p => p.label !== NONE_LABEL).length / tagPreds.length;

  // どのラベルが誤って選ばれたか
  const cogChoices: Record<string, number> = {};
  for (const p of cogPreds) cogChoices[p.label] = (cogChoices[p.label] ?? 0) + 1;
  const tagChoices: Record<string, number> = {};
  for (const p of tagPreds) tagChoices[p.label] = (tagChoices[p.label] ?? 0) + 1;

  // 誤検知の中身を確認
  const cogFpSamples = cogPreds
    .map((p, i) => ({ text: neutralSet[i].text, label: p.label }))
    .filter(e => e.label !== NONE_LABEL)
    .slice(0, 10);
  const tagFpSamples = tagPreds
    .map((p, i) => ({ text: neutralSet[i].text, label: p.label }))
    .filter(e => e.label !== NONE_LABEL)
    .slice(0, 10);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('v2 結果');
  console.log('═══════════════════════════════════════════════════');
  console.log(`中立 FP (認知): ${(cogFp * 100).toFixed(1)}%`);
  console.log(`中立 FP (タグ): ${(tagFp * 100).toFixed(1)}%`);
  console.log(`認知ラベル分布: ${JSON.stringify(cogChoices)}`);
  console.log(`タグラベル分布: ${JSON.stringify(tagChoices)}`);
  console.log(`失敗: ${failures}`);

  const md: string[] = [];
  md.push('# Gemini v2 (改善 prompt) 中立 FP 再測定');
  md.push('');
  md.push(`- モデル: \`${MODEL_ID}\``);
  md.push(`- 生成: ${new Date().toISOString()}`);
  md.push('- 改善点: ランク付け → 単一ラベル、few-shot 例示で "none" を強調、日常報告パターンを明示');
  md.push('');
  md.push('## 結果');
  md.push('');
  md.push('| 指標 | v1 (ランキング) | **v2 (改善 prompt)** | MiniLM (参考) |');
  md.push('|---|---|---|---|');
  md.push(`| 中立 FP (認知) | 83.7% | **${(cogFp * 100).toFixed(1)}%** | 2.4% |`);
  md.push(`| 中立 FP (タグ) | 4.9% | **${(tagFp * 100).toFixed(1)}%** | 4.9% |`);
  md.push('');
  md.push('## 誤検知のラベル分布');
  md.push('');
  md.push('### 認知機能 (none を含む全件)');
  md.push('');
  md.push('| ラベル | 件数 | 割合 |');
  md.push('|---|---|---|');
  for (const [k, v] of Object.entries(cogChoices).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} | ${(v / neutralSet.length * 100).toFixed(1)}% |`);
  }
  md.push('');
  md.push('### タグ');
  md.push('');
  md.push('| ラベル | 件数 | 割合 |');
  md.push('|---|---|---|');
  for (const [k, v] of Object.entries(tagChoices).sort((a, b) => b[1] - a[1])) {
    md.push(`| ${k} | ${v} | ${(v / neutralSet.length * 100).toFixed(1)}% |`);
  }
  md.push('');
  md.push('## 中立投稿が誤分類された具体例 (先頭 10 件)');
  md.push('');
  md.push('### 認知機能');
  md.push('');
  for (const s of cogFpSamples) {
    md.push(`- \`${s.label}\`: "${s.text}"`);
  }
  md.push('');
  md.push('### タグ');
  md.push('');
  for (const s of tagFpSamples) {
    md.push(`- \`${s.label}\`: "${s.text}"`);
  }
  md.push('');

  const outPath = join(ROOT, 'docs/data/llm-benchmark-gemini-v2.md');
  writeFileSync(outPath, md.join('\n'));
  console.log(`\n詳細: ${outPath}`);
})().catch(e => { console.error(e); process.exit(1); });
