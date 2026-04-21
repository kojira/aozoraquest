/**
 * scripts/validate-data.ts
 *
 * docs/data/*.json の整合性を検証する。
 * - jobs.json: 16 ジョブのステータス合計が 100、認知機能係数の行和が 1.0
 * - action-weights.json: アクション重みの整合性、opposing pairs の対称性
 * - tags.json: 9 タグ × 10 件 = 90 件揃っているか
 *
 * 実行: pnpm tsx scripts/validate-data.ts
 * 終了コード: エラーがあれば 1
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARCHETYPES } from '../packages/core/src/types.js';

const ROOT = new URL('..', import.meta.url).pathname;
const errors: string[] = [];
const warnings: string[] = [];

function loadJson<T>(relPath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf-8')) as T;
}

// ─────────────────────────────────────────────────
// jobs.json
// ─────────────────────────────────────────────────

interface JobsData {
  jobs: Record<string, {
    names: Record<string, string>;
    stats: number[];
    dominantFunction: string;
    auxiliaryFunction: string;
  }>;
  statOrder: string[];
  cognitiveFunctions: Record<string, string>;
  cognitiveToRpgCoefficients: Record<string, Record<string, number>>;
}

function validateJobs() {
  console.log('## jobs.json\n');
  const data = loadJson<JobsData>('docs/data/jobs.json');

  // Archetype の単一ソースは packages/core/src/types.ts の ARCHETYPES
  const expectedJobs = [...ARCHETYPES];
  const foundJobs = Object.keys(data.jobs);

  // 16 ジョブ揃っているか
  for (const j of expectedJobs) {
    if (!(j in data.jobs)) errors.push(`jobs.json: 欠落ジョブ ${j}`);
  }
  for (const j of foundJobs) {
    if (!expectedJobs.includes(j)) warnings.push(`jobs.json: 未知のジョブ ${j}`);
  }
  console.log(`- ジョブ数: ${foundJobs.length} (期待 16)`);

  // ステータス合計チェック
  const badSums: string[] = [];
  for (const [id, job] of Object.entries(data.jobs)) {
    const sum = job.stats.reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      badSums.push(`  ${id}: sum=${sum} (stats=[${job.stats.join(',')}])`);
    }
  }
  if (badSums.length === 0) {
    console.log(`- ステータス合計=100: **全 16 ジョブ OK** ✓`);
  } else {
    errors.push(`jobs.json: ステータス合計が 100 でないジョブ`);
    for (const b of badSums) console.log(b);
  }

  // statOrder が 5 軸か
  console.log(`- statOrder: [${data.statOrder.join(', ')}] (期待 5 軸)`);
  if (data.statOrder.length !== 5) errors.push(`jobs.json: statOrder が 5 要素ではない`);

  // 認知機能係数の行和 = 1.0
  const functions = ['Ni','Ne','Si','Se','Ti','Te','Fi','Fe'];
  const badRows: string[] = [];
  for (const f of functions) {
    const row = data.cognitiveToRpgCoefficients[f];
    if (!row) {
      errors.push(`jobs.json: cognitiveToRpgCoefficients の ${f} が欠落`);
      continue;
    }
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      badRows.push(`  ${f}: sum=${sum.toFixed(3)} (row=${JSON.stringify(row)})`);
    }
  }
  if (badRows.length === 0) {
    console.log(`- 認知機能係数 行和=1.0: **全 8 機能 OK** ✓`);
  } else {
    errors.push(`jobs.json: cognitiveToRpgCoefficients の行和が 1.0 でない`);
    for (const b of badRows) console.log(b);
  }

  // ドミナント / オグジリアリー関数のカバレッジ
  const domCount: Record<string, number> = {};
  const auxCount: Record<string, number> = {};
  for (const job of Object.values(data.jobs)) {
    domCount[job.dominantFunction] = (domCount[job.dominantFunction] ?? 0) + 1;
    auxCount[job.auxiliaryFunction] = (auxCount[job.auxiliaryFunction] ?? 0) + 1;
  }
  console.log(`- Dominant function 分布: ${JSON.stringify(domCount)}`);
  console.log(`- Auxiliary function 分布: ${JSON.stringify(auxCount)}`);
  for (const f of functions) {
    if ((domCount[f] ?? 0) !== 2) warnings.push(`jobs.json: dominant=${f} が 2 ジョブじゃない (${domCount[f] ?? 0})`);
    if ((auxCount[f] ?? 0) !== 2) warnings.push(`jobs.json: auxiliary=${f} が 2 ジョブじゃない (${auxCount[f] ?? 0})`);
  }

  console.log();
}

// ─────────────────────────────────────────────────
// action-weights.json
// ─────────────────────────────────────────────────

interface ActionWeightsData {
  parameters: {
    dailyCapPerActionType: number;
    decayHalfLifeDays: number;
    minStatValue: number;
    opposingPairs: string[][];
  };
  actions: Record<string, {
    weights: Record<string, number>;
    detection: unknown;
  }>;
  resolutionOrder: string[];
}

function validateActionWeights() {
  console.log('## action-weights.json\n');
  const data = loadJson<ActionWeightsData>('docs/data/action-weights.json');

  const actionIds = Object.keys(data.actions);
  console.log(`- アクション数: ${actionIds.length}`);
  console.log(`- 日次上限: ${data.parameters.dailyCapPerActionType}`);
  console.log(`- 減衰半減期: ${data.parameters.decayHalfLifeDays} 日`);
  console.log(`- 床値: ${data.parameters.minStatValue}`);
  console.log(`- Opposing pairs: ${JSON.stringify(data.parameters.opposingPairs)}`);

  // resolutionOrder のアクションはすべて定義されているか
  for (const a of data.resolutionOrder) {
    if (!(a in data.actions)) errors.push(`action-weights.json: resolutionOrder の ${a} が actions に未定義`);
  }
  for (const a of actionIds) {
    if (!data.resolutionOrder.includes(a)) warnings.push(`action-weights.json: actions.${a} が resolutionOrder に含まれていない`);
  }

  // 各アクションの重みが 5 軸揃っているか、opposing pairs と矛盾していないか
  const stats = ['atk', 'def', 'agi', 'int', 'luk'];
  for (const [id, action] of Object.entries(data.actions)) {
    for (const s of stats) {
      if (!(s in action.weights)) errors.push(`action-weights.json: ${id}.weights に ${s} がない`);
    }
  }

  // Opposing pairs の symmetry チェック
  for (const [a, b] of data.parameters.opposingPairs) {
    let aPositive = 0, bPositive = 0, aNegative = 0, bNegative = 0;
    for (const action of Object.values(data.actions)) {
      if ((action.weights[a] ?? 0) > 0) aPositive++;
      if ((action.weights[b] ?? 0) > 0) bPositive++;
      if ((action.weights[a] ?? 0) < 0) aNegative++;
      if ((action.weights[b] ?? 0) < 0) bNegative++;
    }
    console.log(`- Pair (${a}, ${b}): ${a}+:${aPositive}, ${a}-:${aNegative}, ${b}+:${bPositive}, ${b}-:${bNegative}`);
  }

  console.log();
}

// ─────────────────────────────────────────────────
// tags.json
// ─────────────────────────────────────────────────

interface TagsData {
  metadata: {
    embeddingModel: string;
    dimensions: number;
    classificationMethod: string;
    perTagCount: number;
  };
  tags: Record<string, {
    description: string;
    prototypes: Array<{ text: string }>;
  }>;
}

function validateTags() {
  console.log('## tags.json\n');
  const data = loadJson<TagsData>('docs/data/tags.json');

  const expectedTags = ['question','distress','goodnews','humor','analysis','opinion','underseen','fresh','debated'];
  const foundTags = Object.keys(data.tags);

  console.log(`- タグ数: ${foundTags.length} (期待 9)`);
  for (const t of expectedTags) {
    if (!(t in data.tags)) errors.push(`tags.json: 欠落タグ ${t}`);
  }

  // プロトタイプ件数
  let totalProto = 0;
  for (const [id, tag] of Object.entries(data.tags)) {
    const n = tag.prototypes?.length ?? 0;
    totalProto += n;
    if (n !== data.metadata.perTagCount) {
      warnings.push(`tags.json: ${id} のプロトタイプが ${n} 件 (期待 ${data.metadata.perTagCount})`);
    }
  }
  console.log(`- プロトタイプ総数: ${totalProto} (期待 ${expectedTags.length * data.metadata.perTagCount})`);

  // プロトタイプの重複チェック (タグ間で同じテキストが使われていないか)
  const textToTag = new Map<string, string>();
  for (const [id, tag] of Object.entries(data.tags)) {
    for (const p of tag.prototypes ?? []) {
      if (textToTag.has(p.text)) {
        errors.push(`tags.json: プロトタイプ重複 "${p.text.slice(0, 40)}..." (${textToTag.get(p.text)} と ${id})`);
      }
      textToTag.set(p.text, id);
    }
  }

  // メタデータ
  console.log(`- モデル宣言: ${data.metadata.embeddingModel}`);
  console.log(`- 次元: ${data.metadata.dimensions}`);
  console.log(`- 分類方式: ${data.metadata.classificationMethod}`);

  if (data.metadata.embeddingModel !== 'sirasagi62/ruri-v3-30m-ONNX') {
    warnings.push(`tags.json: metadata.embeddingModel が採用モデルと一致しない (ここは参考情報で、実コードは packages/core/src/embedding-config.ts)`);
  }

  console.log();
}

// ─────────────────────────────────────────────────
// packages/prompts/cognitive/*.json
// ─────────────────────────────────────────────────

function validateCognitivePrototypes() {
  console.log('## packages/prompts/cognitive/*.json\n');
  const functions = ['Ni','Ne','Si','Se','Ti','Te','Fi','Fe'];
  const allTexts = new Set<string>();
  let total = 0;

  for (const f of functions) {
    try {
      const data = loadJson<{ prototypes: Array<{ text: string }> }>(`packages/prompts/cognitive/${f}.json`);
      const n = data.prototypes?.length ?? 0;
      total += n;
      if (n !== 25) warnings.push(`${f}.json: ${n} 件 (期待 25)`);
      for (const p of data.prototypes ?? []) {
        if (allTexts.has(p.text)) errors.push(`cognitive: 重複 "${p.text.slice(0, 40)}..."`);
        allTexts.add(p.text);
      }
      console.log(`- ${f}.json: ${n} 件`);
    } catch (e) {
      warnings.push(`cognitive/${f}.json: 読み込み失敗 ${String(e).slice(0, 100)}`);
    }
  }
  console.log(`- 合計: ${total} 件 (期待 ${functions.length * 25})`);
  console.log();
}

// ─────────────────────────────────────────────────
// lexicon JSON の knownValues が core/types.ts の ARCHETYPES と一致するか
// (archetype のリネーム時にここが漏れないようチェック)
// ─────────────────────────────────────────────────

function validateLexiconArchetypes() {
  console.log('## lexicon knownValues vs ARCHETYPES\n');
  const expected = [...ARCHETYPES].sort().join(',');
  const targets = [
    { path: 'packages/lexicons/app/aozoraquest/analysis.json', paths: ['defs.main.record.properties.archetype.knownValues', 'defs.jobLevel.properties.archetype.knownValues', 'defs.main.record.properties.pendingArchetype.knownValues'] },
    { path: 'packages/lexicons/app/aozoraquest/profile.json', paths: ['defs.main.record.properties.targetJob.knownValues'] },
  ];
  for (const t of targets) {
    const doc = loadJson<unknown>(t.path);
    for (const pth of t.paths) {
      const arr = getPath(doc, pth) as string[] | undefined;
      if (!arr) { errors.push(`${t.path}: ${pth} が見つからない`); continue; }
      const got = [...arr].sort().join(',');
      if (got !== expected) {
        errors.push(`${t.path}: ${pth} が ARCHETYPES と不一致`);
        console.log(`  expected: ${expected}`);
        console.log(`  got     : ${got}`);
      } else {
        console.log(`- ${t.path}:${pth} ✓`);
      }
    }
  }
  console.log();
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

// ─────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────

console.log('# データ整合性レポート\n');
console.log(`生成: ${new Date().toISOString()}\n`);

validateJobs();
validateActionWeights();
validateTags();
validateCognitivePrototypes();
validateLexiconArchetypes();

console.log('## サマリー\n');
console.log(`- エラー: ${errors.length}`);
console.log(`- 警告: ${warnings.length}`);
if (errors.length > 0) {
  console.log('\n### エラー');
  for (const e of errors) console.log(`- ${e}`);
}
if (warnings.length > 0) {
  console.log('\n### 警告');
  for (const w of warnings) console.log(`- ${w}`);
}

process.exit(errors.length > 0 ? 1 : 0);
