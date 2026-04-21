/**
 * scripts/validate-llm-bonsai.ts
 *
 * Bonsai-1.7B (1-bit 量子化、~291MB) で日本語生成を実測する。
 * 精霊の発言 (挨拶・クエスト通知・LV アップ等) を想定したプロンプトで
 * 品質とレイテンシを計測。
 *
 * 実行: pnpm tsx scripts/validate-llm-bonsai.ts
 * 出力: docs/data/llm-benchmark-bonsai.md
 */

import { pipeline, env } from '@huggingface/transformers';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

env.allowLocalModels = false;
env.useBrowserCache = false;

const MODEL_ID = 'onnx-community/Bonsai-1.7B-ONNX' as const;
const DTYPE = 'q1' as const;
const ROOT = new URL('..', import.meta.url).pathname;

interface TestPrompt {
  label: string;
  system?: string;
  prompt: string;
  expected: string; // どんな雰囲気の出力を期待するか (subjective check)
}

const TESTS: TestPrompt[] = [
  {
    label: '簡単な日本語生成',
    prompt: '春の空を一言で表してください。',
    expected: '春の空の描写 (日本語で 20-50 字程度)',
  },
  {
    label: '挨拶 (朝)',
    system: 'あなたは青空の精霊です。穏やかで詩的な日本語で話します。',
    prompt: 'ユーザー名 "ことりら" に朝の挨拶を一言。',
    expected: '穏やかな朝の挨拶 (日本語、50-80 字)',
  },
  {
    label: 'クエスト達成の祝福',
    system: 'あなたは青空の精霊です。穏やかで詩的な日本語で話します。',
    prompt: 'ユーザーが「軽やかに短文を 3 つ放つ」クエストを達成しました。穏やかな祝福を一言。',
    expected: '祝福の言葉 (日本語、40-70 字)',
  },
  {
    label: 'LV アップ',
    system: 'あなたは青空の精霊です。穏やかで詩的な日本語で話します。',
    prompt: 'ユーザーがレベル 5 に上がりました。祝福を一言。',
    expected: 'LV アップの祝福 (日本語、40-70 字)',
  },
  {
    label: '節制クエストの提示',
    system: 'あなたは青空の精霊です。穏やかで詩的な日本語で話します。',
    prompt: '今日は長文分析を控えるクエストが出ました。ユーザーへの案内を一言。',
    expected: 'クエスト案内 (日本語、50-80 字)',
  },
  {
    label: '基本文法テスト',
    prompt: '次の文を完成させてください: 朝の光が',
    expected: '自然な日本語の続き',
  },
  {
    label: '指示理解テスト',
    prompt: 'リンゴ、バナナ、カエル、ブドウ。この中で果物でないものはどれですか？',
    expected: '「カエル」と正しく答える',
  },
];

interface Result {
  label: string;
  expected: string;
  output: string;
  latencyMs: number;
  tokensGenerated: number;
  tokensPerSec: number;
}

function buildChatPrompt(system: string | undefined, user: string): string {
  // Bonsai は Mistral 系のトークナイザ。Instruct-tuned でなければ素の prompt で試す
  if (system) {
    return `### System:\n${system}\n\n### User:\n${user}\n\n### Assistant:\n`;
  }
  return user;
}

async function main() {
  console.log(`モデル: ${MODEL_ID}, dtype: ${DTYPE}`);
  console.log(`(初回ロードで ~291MB のダウンロードが発生します)\n`);

  const loadStart = performance.now();
  const generator: any = await pipeline('text-generation', MODEL_ID, {
    dtype: DTYPE,
  });
  const loadMs = performance.now() - loadStart;
  console.log(`ロード完了: ${(loadMs / 1000).toFixed(1)}s\n`);

  const results: Result[] = [];

  for (const test of TESTS) {
    console.log(`[${test.label}]`);
    console.log(`  prompt: "${test.prompt}"`);

    const input = buildChatPrompt(test.system, test.prompt);
    const t0 = performance.now();
    const out: any = await generator(input, {
      max_new_tokens: 100,
      do_sample: true,
      temperature: 0.8,
      top_p: 0.9,
      return_full_text: false,
    });
    const latencyMs = performance.now() - t0;

    const generated = Array.isArray(out) ? out[0].generated_text : out.generated_text;
    const text = String(generated ?? '').trim();

    // 単純な tokens 見積もり (日本語は 1 文字 ~1.5-2 tokens)
    const charCount = text.length;
    const tokensEst = Math.round(charCount * 1.8);
    const tokensPerSec = tokensEst / (latencyMs / 1000);

    results.push({
      label: test.label,
      expected: test.expected,
      output: text,
      latencyMs,
      tokensGenerated: tokensEst,
      tokensPerSec,
    });

    console.log(`  出力: "${text}"`);
    console.log(`  レイテンシ: ${(latencyMs / 1000).toFixed(1)}s, 推定 ${tokensPerSec.toFixed(1)} tok/s\n`);
  }

  // サマリー
  const avgLatency = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;
  const avgTokensPerSec = results.reduce((s, r) => s + r.tokensPerSec, 0) / results.length;

  console.log('═══════════════════════════════════════════════════');
  console.log(`平均レイテンシ: ${(avgLatency / 1000).toFixed(1)}s`);
  console.log(`平均速度:       ${avgTokensPerSec.toFixed(1)} tok/s`);
  console.log('═══════════════════════════════════════════════════');

  // Markdown
  const md: string[] = [];
  md.push('# Bonsai-1.7B 日本語生成実測');
  md.push('');
  md.push(`- モデル: \`${MODEL_ID}\` (dtype: ${DTYPE})`);
  md.push(`- 実行: Node + ONNX Runtime CPU (WebGPU ではない)`);
  md.push(`- 生成: ${new Date().toISOString()}`);
  md.push(`- モデルロード: ${(loadMs / 1000).toFixed(1)}s`);
  md.push(`- 平均レイテンシ: ${(avgLatency / 1000).toFixed(1)}s`);
  md.push(`- 平均速度: ${avgTokensPerSec.toFixed(1)} tok/s (推定)`);
  md.push('');
  md.push('**注意**: CPU/WASM 実行なので速度は参考値。WebGPU + モバイルの実速は別途 webml-community の Space で確認。');
  md.push('');
  md.push('## モデルサイズ');
  md.push('- q1: **291 MB** (推奨、WebGPU で最速)');
  md.push('- q2: 506 MB');
  md.push('- q4: 1.12 GB');
  md.push('');
  md.push('## テスト結果');
  md.push('');

  for (const r of results) {
    md.push(`### ${r.label}`);
    md.push('');
    md.push(`- 期待: ${r.expected}`);
    md.push(`- レイテンシ: ${(r.latencyMs / 1000).toFixed(1)}s`);
    md.push(`- 速度: ${r.tokensPerSec.toFixed(1)} tok/s (推定)`);
    md.push(`- 出力:`);
    md.push('');
    md.push('```');
    md.push(r.output || '(空)');
    md.push('```');
    md.push('');
  }

  md.push('## 定性評価 (要 人間判定)');
  md.push('');
  md.push('以下を人間がチェック:');
  md.push('1. **日本語として自然か** (各出力の文末・助詞・語彙)');
  md.push('2. **指示を理解しているか** (「カエル」テストが当たったか等)');
  md.push('3. **システムプロンプトで口調が変わるか** (精霊の詩的トーンが出ているか)');
  md.push('4. **破綻はないか** (繰り返し、文字化け、英語混在)');
  md.push('');

  const outPath = join(ROOT, 'docs/data/llm-benchmark-bonsai.md');
  writeFileSync(outPath, md.join('\n'));
  console.log(`\n詳細: ${outPath}`);
}

main().catch(e => {
  console.error('エラー:', e);
  process.exit(1);
});
