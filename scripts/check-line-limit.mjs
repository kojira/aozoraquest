#!/usr/bin/env node
// 1 ファイル 800 行ルール (CLAUDE.md, Refs #718) の CI ゲート。
// git 管理下のテキストファイルが 800 行を超えたら違反を列挙して exit 1。
// 例外はロックファイル・バイナリ・下記の自動生成ファイルだけ (汎用の除外機構は作らない)。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const MAX_LINES = 800;
const LOCK_FILES = new Set(['pnpm-lock.yaml', 'Cargo.lock']);
const GENERATED_FILES = new Set([
  // scripts/bench-tinyswallow-instruction-following.mjs が出力するベンチ結果
  'docs/bench/tinyswallow-instruction-following-result.json',
]);

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const offenders = [];
for (const file of files) {
  if (LOCK_FILES.has(basename(file)) || GENERATED_FILES.has(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // 作業ツリーで削除済み
  }
  if (buf.subarray(0, 8000).includes(0)) continue; // バイナリ (git と同じ NUL 判定)
  const text = buf.toString('utf8');
  const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  if (lines > MAX_LINES) offenders.push(`${lines}\t${file}`);
}

if (offenders.length > 0) {
  console.error(`800 行を超えるファイルがあります (上限 ${MAX_LINES} 行):`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`OK: ${files.length} 件の git 管理ファイルはすべて ${MAX_LINES} 行以内 (ロック/バイナリ/生成物を除く)`);
