#!/usr/bin/env node
/**
 * TinySwallow の指示追従性: system role に指示を入れた場合 vs user role に
 * 入れた場合を 50 テストで比較する Node CLI ベンチ。
 *
 * 各テストは「機械的に PASS/FAIL を判定できる指示」+「中立的なユーザ質問」
 * で構成する。同じ指示を以下の 2 通りで TinySwallow に投げ、出力に対して
 * evaluator を当てる:
 *
 *   condition A (system): [{ system: instruction }, { user: question }]
 *   condition B (user):   [{ user: instruction + '\n\n質問: ' + question }]
 *
 * 結果は results JSON に書き出し + 標準出力にサマリ。
 *
 * 使い方:
 *   node scripts/bench-tinyswallow-instruction-following.mjs [--temp 0] [--max 100] [--limit 50]
 *
 * 注意: Node 上では WebGPU が無いので CPU/WASM (q4) で走る。M1/M2 Mac で
 * 1 generation ~5-15s、100 generation で ~10-25 分目安。
 */

import { pipeline, env } from '@huggingface/transformers';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TESTS, cleanOutput } from '../docs/bench/tinyswallow-tests.mjs';

env.allowLocalModels = false;
// Node 上の cache 場所 (HF default は ~/.cache/huggingface)
// env.cacheDir = '...';

const MODEL_ID = 'onnx-community/TinySwallow-1.5B-Instruct-ONNX';
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'docs', 'bench');

// ──────────────────────────────────────────────
// CLI 引数
// ──────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  return argv[i + 1];
}
const TEMP = parseFloat(arg('--temp', '0'));
const MAX_TOK = parseInt(arg('--max', '100'), 10);
const LIMIT = parseInt(arg('--limit', '50'), 10);

// ──────────────────────────────────────────────
// 実行 (TESTS / cleanOutput は docs/bench/tinyswallow-tests.mjs から)
// ──────────────────────────────────────────────

console.log(`Loading TinySwallow (CPU/WASM, q4) — first run downloads ~600MB...`);
const t0 = Date.now();
const pipe = await pipeline('text-generation', MODEL_ID, {
  device: 'cpu',
  dtype: 'q4',
});
console.log(`Loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

async function gen(messages) {
  const out = await pipe(messages, {
    max_new_tokens: MAX_TOK,
    temperature: TEMP,
    do_sample: TEMP > 0,
    repetition_penalty: 1.1,
  });
  const first = Array.isArray(out) ? out[0] : out;
  const g = first?.generated_text;
  if (Array.isArray(g)) {
    const last = g[g.length - 1];
    return typeof last?.content === 'string' ? last.content : '';
  }
  return typeof g === 'string' ? g : '';
}

const tests = TESTS.slice(0, LIMIT);
const results = [];
let sysPass = 0;
let userPass = 0;
let bothPass = 0; // system + user の両方に同じ指示を入れる条件 C

console.log(`Running ${tests.length} tests × 3 conditions (temp=${TEMP}, max_new_tokens=${MAX_TOK})...\n`);

for (let i = 0; i < tests.length; i++) {
  const { instruction, q, check } = tests[i];
  const tStart = Date.now();

  // Condition A: system のみに指示
  const sysOutRaw = await gen([
    { role: 'system', content: instruction },
    { role: 'user', content: q },
  ]);
  const sysOut = cleanOutput(sysOutRaw);
  const sysJ = check(sysOut);

  // Condition B: user のみに指示 (system 無し)
  const userOutRaw = await gen([
    { role: 'user', content: `${instruction}\n\n質問: ${q}` },
  ]);
  const userOut = cleanOutput(userOutRaw);
  const userJ = check(userOut);

  // Condition C: system + user 両方に指示 (実装で取りやすい中間案)
  const bothOutRaw = await gen([
    { role: 'system', content: instruction },
    { role: 'user', content: `${instruction}\n\n質問: ${q}` },
  ]);
  const bothOut = cleanOutput(bothOutRaw);
  const bothJ = check(bothOut);

  if (sysJ.pass) sysPass++;
  if (userJ.pass) userPass++;
  if (bothJ.pass) bothPass++;

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(
    `#${String(i + 1).padStart(2)} (${elapsed}s) [${sysJ.pass ? '✓' : '✗'}sys / ${userJ.pass ? '✓' : '✗'}user / ${bothJ.pass ? '✓' : '✗'}both] ${instruction.slice(0, 30)}${instruction.length > 30 ? '…' : ''}`,
  );
  if (!sysJ.pass) console.log(`     sys   FAIL: ${sysJ.reason} | "${sysOut.replace(/\n/g, '\\n').slice(0, 80)}"`);
  if (!userJ.pass) console.log(`     user  FAIL: ${userJ.reason} | "${userOut.replace(/\n/g, '\\n').slice(0, 80)}"`);
  if (!bothJ.pass) console.log(`     both  FAIL: ${bothJ.reason} | "${bothOut.replace(/\n/g, '\\n').slice(0, 80)}"`);

  results.push({ i: i + 1, instruction, q, sysOut, sysJ, userOut, userJ, bothOut, bothJ, elapsedSec: parseFloat(elapsed) });
}

const n = tests.length;
const summary = {
  meta: {
    model: MODEL_ID,
    temperature: TEMP,
    maxNewTokens: MAX_TOK,
    nTests: n,
    timestamp: new Date().toISOString(),
  },
  totals: {
    systemPass: sysPass,
    systemRate: sysPass / n,
    userPass,
    userRate: userPass / n,
    bothPass,
    bothRate: bothPass / n,
  },
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, 'tinyswallow-instruction-following-result.json');
writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log('\n────────────── SUMMARY ──────────────');
console.log(`Tests:  ${n}`);
console.log(`system のみ: ${sysPass}/${n} = ${(sysPass / n * 100).toFixed(1)}%`);
console.log(`user のみ:   ${userPass}/${n} = ${(userPass / n * 100).toFixed(1)}%`);
console.log(`両方に投入: ${bothPass}/${n} = ${(bothPass / n * 100).toFixed(1)}%`);
console.log(`\nresults saved to: ${outPath}`);
