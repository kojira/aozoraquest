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
// テスト 50 件 (browser 版 HTML と同じ内容)
// ──────────────────────────────────────────────
const Q1 = '今日の天気は？';
const Q2 = 'おはよう。';
const Q3 = '元気？';
const Q4 = '何してる？';
const Q5 = '好きな食べ物は？';

const countMatches = (s, re) => (s.match(re) ?? []).length;
const countSentences = (s) =>
  s.split(/[。！？!?]/).map((x) => x.trim()).filter((x) => x.length > 0).length;
const ONLY_HIRAGANA = /^[\u3040-\u309fー、。！？!?\s]*$/;
const ONLY_KATAKANA = /^[\u30a0-\u30ffー、。！？!?\s]*$/;
const HAS_KANJI = /[\u4e00-\u9fff]/;
const HAS_DIGITS = /[0-9０-９]/;
const HAS_ALPHA = /[a-zA-Z]/;
const HAS_NEWLINE = /\n/;

const TESTS = [
  { instruction: '10 字以内で答えてください。', q: Q3, check: (t) => ({ pass: t.length <= 10, reason: `len=${t.length}` }) },
  { instruction: '20 字以内で答えてください。', q: Q1, check: (t) => ({ pass: t.length <= 20, reason: `len=${t.length}` }) },
  { instruction: '30 字以内で答えてください。', q: Q1, check: (t) => ({ pass: t.length <= 30, reason: `len=${t.length}` }) },
  { instruction: '50 字以内で答えてください。', q: Q5, check: (t) => ({ pass: t.length <= 50, reason: `len=${t.length}` }) },
  { instruction: '5 字ちょうどで答えてください。', q: Q3, check: (t) => ({ pass: t.length === 5, reason: `len=${t.length}` }) },
  { instruction: '15 字ちょうどで答えてください。', q: Q4, check: (t) => ({ pass: t.length === 15, reason: `len=${t.length}` }) },
  { instruction: '長くても 100 字以内で。', q: Q1, check: (t) => ({ pass: t.length <= 100, reason: `len=${t.length}` }) },
  { instruction: '40 字以内で短く。', q: Q5, check: (t) => ({ pass: t.length <= 40, reason: `len=${t.length}` }) },

  { instruction: '1 文だけで答えてください。', q: Q1, check: (t) => { const n = countSentences(t); return { pass: n === 1, reason: `sentences=${n}` }; } },
  { instruction: '2 文で答えてください。', q: Q5, check: (t) => { const n = countSentences(t); return { pass: n === 2, reason: `sentences=${n}` }; } },
  { instruction: '3 文ちょうどで答えてください。', q: Q4, check: (t) => { const n = countSentences(t); return { pass: n === 3, reason: `sentences=${n}` }; } },
  { instruction: '1 文以内で簡潔に。', q: Q3, check: (t) => { const n = countSentences(t); return { pass: n <= 1, reason: `sentences=${n}` }; } },

  { instruction: '「はい、」で始めてください。', q: Q3, check: (t) => ({ pass: t.startsWith('はい、'), reason: `start="${t.slice(0, 6)}"` }) },
  { instruction: '「いいえ、」で始めてください。', q: Q3, check: (t) => ({ pass: t.startsWith('いいえ、'), reason: `start="${t.slice(0, 6)}"` }) },
  { instruction: '「そうだね」で始めてください。', q: Q4, check: (t) => ({ pass: t.startsWith('そうだね'), reason: `start="${t.slice(0, 6)}"` }) },
  { instruction: '「えっと」で始めてください。', q: Q5, check: (t) => ({ pass: t.startsWith('えっと'), reason: `start="${t.slice(0, 4)}"` }) },
  { instruction: '「うん、」で始めてください。', q: Q2, check: (t) => ({ pass: t.startsWith('うん、'), reason: `start="${t.slice(0, 4)}"` }) },

  { instruction: '「。」で終えてください。', q: Q1, check: (t) => ({ pass: /。\s*$/.test(t), reason: `end="${t.slice(-3)}"` }) },
  { instruction: '「！」で終えてください。', q: Q5, check: (t) => ({ pass: /[！!]\s*$/.test(t), reason: `end="${t.slice(-3)}"` }) },
  { instruction: '「？」で終えてください。', q: Q4, check: (t) => ({ pass: /[？?]\s*$/.test(t), reason: `end="${t.slice(-3)}"` }) },
  { instruction: '「ね。」で終えてください。', q: Q1, check: (t) => ({ pass: /ね。\s*$/.test(t), reason: `end="${t.slice(-3)}"` }) },
  { instruction: '「よ。」で終えてください。', q: Q3, check: (t) => ({ pass: /よ。\s*$/.test(t), reason: `end="${t.slice(-3)}"` }) },

  { instruction: '答えに「青空」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('青空'), reason: t.includes('青空') ? '' : '青空 not found' }) },
  { instruction: '答えに「風」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('風'), reason: t.includes('風') ? '' : '風 not found' }) },
  { instruction: '答えに「猫」を含めてください。', q: Q5, check: (t) => ({ pass: t.includes('猫'), reason: t.includes('猫') ? '' : '猫 not found' }) },
  { instruction: '答えに「銀河」を含めてください。', q: Q4, check: (t) => ({ pass: t.includes('銀河'), reason: t.includes('銀河') ? '' : '銀河 not found' }) },
  { instruction: '数字「7」を含めてください。', q: Q1, check: (t) => ({ pass: t.includes('7'), reason: t.includes('7') ? '' : '7 not found' }) },
  { instruction: '「!」を 3 個ちょうど含めてください。', q: Q5, check: (t) => { const n = countMatches(t, /[！!]/g); return { pass: n === 3, reason: `count=${n}` }; } },
  { instruction: '「、」を 2 個ちょうど含めてください。', q: Q4, check: (t) => { const n = countMatches(t, /、/g); return { pass: n === 2, reason: `count=${n}` }; } },
  { instruction: '答えのどこかに「ありがとう」を含めて。', q: Q3, check: (t) => ({ pass: t.includes('ありがとう'), reason: t.includes('ありがとう') ? '' : 'not found' }) },

  { instruction: '改行を使わずに 1 行で答えて。', q: Q5, check: (t) => ({ pass: !HAS_NEWLINE.test(t), reason: HAS_NEWLINE.test(t) ? 'has \\n' : '' }) },
  { instruction: '数字を一切使わずに答えて。', q: Q1, check: (t) => ({ pass: !HAS_DIGITS.test(t), reason: HAS_DIGITS.test(t) ? 'has digit' : '' }) },
  { instruction: '英字 (アルファベット) を使わずに。', q: Q5, check: (t) => ({ pass: !HAS_ALPHA.test(t), reason: HAS_ALPHA.test(t) ? 'has alpha' : '' }) },
  { instruction: '絵文字を使わずに答えて。', q: Q4, check: (t) => { const has = /\p{Extended_Pictographic}/u.test(t); return { pass: !has, reason: has ? 'has emoji' : '' }; } },
  { instruction: '「私」という文字を使わずに。', q: Q4, check: (t) => ({ pass: !t.includes('私'), reason: t.includes('私') ? 'has 私' : '' }) },
  { instruction: '「は」という文字を使わずに。', q: Q5, check: (t) => ({ pass: !t.includes('は'), reason: t.includes('は') ? 'has は' : '' }) },
  { instruction: '感嘆符 (! / ！) を使わないで。', q: Q5, check: (t) => ({ pass: !/[!！]/.test(t), reason: /[!！]/.test(t) ? 'has !' : '' }) },
  { instruction: 'カタカナを使わないで。', q: Q5, check: (t) => { const has = /[\u30a0-\u30ff]/.test(t); return { pass: !has, reason: has ? 'has カタカナ' : '' }; } },

  { instruction: '答えを全てひらがなで。漢字・カタカナ・英字を使わない。', q: Q3, check: (t) => ({ pass: ONLY_HIRAGANA.test(t.trim()), reason: ONLY_HIRAGANA.test(t.trim()) ? '' : 'not all hiragana' }) },
  { instruction: '答えを全てカタカナで。', q: Q3, check: (t) => ({ pass: ONLY_KATAKANA.test(t.trim()), reason: ONLY_KATAKANA.test(t.trim()) ? '' : 'not all katakana' }) },
  { instruction: '漢字を 1 個も使わずに答えて。', q: Q4, check: (t) => ({ pass: !HAS_KANJI.test(t), reason: HAS_KANJI.test(t) ? 'has kanji' : '' }) },
  { instruction: '漢字を 3 個以上含めて答えて。', q: Q1, check: (t) => { const n = countMatches(t, /[\u4e00-\u9fff]/g); return { pass: n >= 3, reason: `kanji=${n}` }; } },

  { instruction: '箇条書きで 3 項目に分けて。各行を「・」で始める。', q: Q5, check: (t) => { const lines = t.split('\n').filter((l) => l.trim().startsWith('・')); return { pass: lines.length === 3, reason: `bullets=${lines.length}` }; } },
  { instruction: '番号付きリストで 3 項目。「1.」「2.」「3.」を含む。', q: Q5, check: (t) => ({ pass: /1\./.test(t) && /2\./.test(t) && /3\./.test(t), reason: 'numbered list missing' }) },
  { instruction: '改行で区切って 4 行で答えて。', q: Q5, check: (t) => { const lines = t.split('\n').filter((l) => l.trim().length > 0); return { pass: lines.length === 4, reason: `lines=${lines.length}` }; } },
  { instruction: '答えを括弧 () で囲んで。', q: Q3, check: (t) => { const tt = t.trim(); return { pass: (tt.startsWith('(') || tt.startsWith('(')) && (tt.endsWith(')') || tt.endsWith(')')), reason: 'no enclosing paren' }; } },

  { instruction: '敬語 (です・ます) で答えて。', q: Q1, check: (t) => ({ pass: /です|ます/.test(t), reason: /です|ます/.test(t) ? '' : 'no です/ます' }) },
  { instruction: 'タメ口で答えて。「です」「ます」は使わない。', q: Q1, check: (t) => ({ pass: !/です|ます/.test(t), reason: /です|ます/.test(t) ? 'has です/ます' : '' }) },
  { instruction: '質問形 (?で終わる文) で答えて。', q: Q1, check: (t) => ({ pass: /[?？]\s*$/.test(t.trim()), reason: 'not a question' }) },
  { instruction: '体言止め (動詞・助動詞で終わらない) で。', q: Q5, check: (t) => { const trimmed = t.trim().replace(/[。、！？!?\s]+$/, ''); const last = trimmed.slice(-1); return { pass: !/[るたいだねよか]/.test(last), reason: `last="${last}"` }; } },
];

if (TESTS.length !== 50) {
  console.error(`⚠️ TESTS.length = ${TESTS.length}, expected 50`);
}

// ──────────────────────────────────────────────
// 実行
// ──────────────────────────────────────────────

function cleanOutput(s) {
  return s
    .replace(/^<\|.*?\|>/g, '')
    .replace(/<\|.*?\|>$/g, '')
    .replace(/^(assistant|system):\s*/i, '')
    .trim();
}

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

console.log(`Running ${tests.length} tests × 2 conditions (temp=${TEMP}, max_new_tokens=${MAX_TOK})...\n`);

for (let i = 0; i < tests.length; i++) {
  const { instruction, q, check } = tests[i];
  const tStart = Date.now();

  const sysOutRaw = await gen([
    { role: 'system', content: instruction },
    { role: 'user', content: q },
  ]);
  const sysOut = cleanOutput(sysOutRaw);
  const sysJ = check(sysOut);

  const userOutRaw = await gen([
    { role: 'user', content: `${instruction}\n\n質問: ${q}` },
  ]);
  const userOut = cleanOutput(userOutRaw);
  const userJ = check(userOut);

  if (sysJ.pass) sysPass++;
  if (userJ.pass) userPass++;

  const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
  console.log(
    `#${String(i + 1).padStart(2)} (${elapsed}s) [${sysJ.pass ? '✓' : '✗'}sys / ${userJ.pass ? '✓' : '✗'}user] ${instruction.slice(0, 30)}${instruction.length > 30 ? '…' : ''}`,
  );
  if (!sysJ.pass) console.log(`     sys   FAIL: ${sysJ.reason} | "${sysOut.replace(/\n/g, '\\n').slice(0, 80)}"`);
  if (!userJ.pass) console.log(`     user  FAIL: ${userJ.reason} | "${userOut.replace(/\n/g, '\\n').slice(0, 80)}"`);

  results.push({ i: i + 1, instruction, q, sysOut, sysJ, userOut, userJ, elapsedSec: parseFloat(elapsed) });
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
    delta: sysPass - userPass,
  },
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, 'tinyswallow-instruction-following-result.json');
writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log('\n────────────── SUMMARY ──────────────');
console.log(`Tests:  ${n}`);
console.log(`system: ${sysPass}/${n} = ${(sysPass / n * 100).toFixed(1)}%`);
console.log(`user:   ${userPass}/${n} = ${(userPass / n * 100).toFixed(1)}%`);
console.log(`Δ:      ${sysPass - userPass > 0 ? '+' : ''}${sysPass - userPass} (${sysPass > userPass ? 'system 勝ち' : sysPass < userPass ? 'user 勝ち' : '同点'})`);
console.log(`\nresults saved to: ${outPath}`);
