/**
 * 指定ハンドルのフォロー中ユーザー全員を AozoraQuest の診断パイプラインに
 * かけて、結果を HTML レポートとして出力する。
 *
 * 使い方:
 *   pnpm tsx scripts/diagnose-follows.ts kojira.io [outfile]
 */

import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtpAgent } from '@atproto/api';
import {
  DIAGNOSIS_MIN_POST_COUNT,
  DIAGNOSIS_POST_LIMIT,
  DIAGNOSIS_TOP_N,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_DTYPE,
  EMBEDDING_MODEL_ID,
  archetypePairRelation,
  diagnose,
  jobDisplayName,
  jobTagline,
  resonance,
  resonanceLabel,
  statVectorToArray,
  type Archetype,
  type CogFunction,
  type DiagnosisResult,
} from '../packages/core/src/index.js';

env.allowLocalModels = false;
env.useBrowserCache = false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(repoRoot, 'apps/web/public/prototypes/cognitive');
const COGNITIVE_FUNCTIONS: CogFunction[] = ['Ni', 'Ne', 'Si', 'Se', 'Ti', 'Te', 'Fi', 'Fe'];

const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' });

interface FollowTarget {
  did: string;
  handle: string;
  displayName: string;
  avatar?: string;
  description?: string;
}

interface DiagnosisRow {
  target: FollowTarget;
  status: 'ok' | 'insufficient' | 'error';
  result?: DiagnosisResult;
  postCount?: number;
  error?: string;
}

async function unpackBinFile(file: string): Promise<Float32Array[]> {
  const buf = await fs.readFile(file);
  const n = buf.readInt32LE(0);
  const d = buf.readInt32LE(4);
  if (d !== EMBEDDING_DIMENSIONS) throw new Error(`dim mismatch in ${file}: ${d} != ${EMBEDDING_DIMENSIONS}`);
  const vecs: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(d);
    for (let k = 0; k < d; k++) v[k] = buf.readFloatLE(8 + (i * d + k) * 4);
    vecs.push(v);
  }
  return vecs;
}

async function loadPrototypes(): Promise<Record<CogFunction, Float32Array[]>> {
  const out = {} as Record<CogFunction, Float32Array[]>;
  for (const fn of COGNITIVE_FUNCTIONS) out[fn] = await unpackBinFile(path.join(PROTO_DIR, `${fn}.bin`));
  return out;
}

async function fetchAllFollows(actor: string): Promise<FollowTarget[]> {
  const out: FollowTarget[] = [];
  let cursor: string | undefined;
  while (true) {
    const res = await publicAgent.app.bsky.graph.getFollows({
      actor,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    for (const f of res.data.follows) {
      out.push({
        did: f.did,
        handle: f.handle,
        displayName: f.displayName ?? f.handle,
        ...(f.avatar ? { avatar: f.avatar } : {}),
        ...(f.description ? { description: f.description } : {}),
      });
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return out;
}

async function fetchUserPosts(actor: string, limit: number): Promise<{ text: string; at: string }[]> {
  const out: { text: string; at: string }[] = [];
  let cursor: string | undefined;
  while (out.length < limit) {
    try {
      const res = await publicAgent.app.bsky.feed.getAuthorFeed({
        actor,
        limit: Math.min(100, limit - out.length),
        ...(cursor ? { cursor } : {}),
        filter: 'posts_no_replies',
      });
      for (const item of res.data.feed) {
        const rec = item.post.record as { text?: string; createdAt?: string };
        if (typeof rec.text === 'string' && rec.text.length >= 10) {
          out.push({ text: rec.text, at: rec.createdAt ?? item.post.indexedAt ?? new Date().toISOString() });
        }
      }
      cursor = res.data.cursor;
      if (!cursor) break;
    } catch (e) {
      console.warn(`  fetch failed for ${actor}:`, (e as Error).message);
      break;
    }
  }
  return out.slice(0, limit);
}

function esc(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderHtml(
  ownerHandle: string,
  ownerArchetype: Archetype | null,
  rows: DiagnosisRow[],
  generatedAt: Date,
): string {
  const ok = rows.filter((r) => r.status === 'ok' && r.result);
  const dist = new Map<string, number>();
  for (const r of ok) {
    if (!r.result) continue;
    const j = jobDisplayName(r.result.archetype, 'default');
    dist.set(j, (dist.get(j) ?? 0) + 1);
  }
  const distRows = [...dist.entries()].sort((a, b) => b[1] - a[1]);

  // 相性 (kojira 側の archetype が分かっていれば計算)
  const withCompat = ok.map((r) => {
    if (!ownerArchetype || !r.result) return { ...r, compat: null };
    const compat = resonance(
      // 自分の stats は持っていないので archetype ベース pair 判定のみを使う
      statVectorToArray({ atk: 20, def: 20, agi: 20, int: 20, luk: 20 }),
      statVectorToArray(r.result.rpgStats),
      ownerArchetype,
      r.result.archetype,
    );
    return { ...r, compat };
  });

  // 相性スコアで降順 (ownerArchetype があるときだけ意味あり)
  withCompat.sort((a, b) => {
    const sa = a.compat?.score ?? 0;
    const sb = b.compat?.score ?? 0;
    return sb - sa;
  });

  const rowsHtml = withCompat.map((r) => {
    if (!r.result) return '';
    const job = jobDisplayName(r.result.archetype, 'default');
    const tag = jobTagline(r.result.archetype) ?? '';
    const top3 = (Object.entries(r.result.cognitiveScores) as [CogFunction, number][])
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `<span class="cog">${k}:${v}</span>`).join(' ');
    const pairLabel = r.compat?.pairRelation?.label ?? '-';
    const pairDesc = r.compat?.pairRelation?.description ?? '';
    const scorePct = r.compat ? Math.round(r.compat.score * 100) : '-';
    const scoreLabel = r.compat ? resonanceLabel(r.compat.score) : '';
    return `
      <tr>
        <td class="avatar-cell">${r.target.avatar ? `<img src="${esc(r.target.avatar)}" alt="">` : ''}</td>
        <td>
          <div class="name"><a href="https://bsky.app/profile/${esc(r.target.handle)}" target="_blank" rel="noopener">${esc(r.target.displayName)}</a></div>
          <div class="handle">@${esc(r.target.handle)}</div>
        </td>
        <td class="job">
          <strong>${esc(job)}</strong>
          <div class="tag">${esc(tag)}</div>
        </td>
        <td class="cognitive">${top3}</td>
        <td class="conf">${esc(r.result.confidence)}</td>
        <td class="pair" title="${esc(pairDesc)}">${esc(pairLabel)}</td>
        <td class="score">${scorePct}<span class="unit">/100</span><div class="score-label">${esc(String(scoreLabel))}</div></td>
      </tr>
    `;
  }).join('');

  const skippedRows = rows.filter((r) => r.status !== 'ok');
  const skippedHtml = skippedRows.length > 0 ? `
    <h2>スキップ (${skippedRows.length} 件)</h2>
    <ul class="skipped">
      ${skippedRows.map((r) => {
        const reason = r.status === 'insufficient'
          ? `投稿不足 (${r.postCount ?? 0} 件 / 最低 ${DIAGNOSIS_MIN_POST_COUNT} 件)`
          : `エラー: ${esc(r.error ?? '不明')}`;
        return `<li><a href="https://bsky.app/profile/${esc(r.target.handle)}" target="_blank" rel="noopener">@${esc(r.target.handle)}</a> — ${reason}</li>`;
      }).join('')}
    </ul>
  ` : '';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>@${esc(ownerHandle)} のフォロー相手の気質診断</title>
<style>
  body { font-family: "Hiragino Maru Gothic ProN", "Noto Sans JP", sans-serif; margin: 2em; background: #eaf3ff; color: #1c2b44; }
  h1 { margin: 0 0 0.4em; }
  .meta { color: #546580; font-size: 0.9em; margin-bottom: 1.5em; }
  .summary { background: white; border: 2px solid #9fd7ff; border-radius: 6px; padding: 1em 1.2em; margin-bottom: 1.5em; }
  .summary h2 { margin-top: 0; }
  .dist { display: flex; flex-wrap: wrap; gap: 0.6em; list-style: none; padding: 0; }
  .dist li { background: #d6e9ff; padding: 0.3em 0.7em; border-radius: 4px; font-size: 0.9em; }
  .dist li strong { color: #1c2b44; font-weight: 700; margin-right: 0.3em; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 0.6em 0.8em; text-align: left; border-bottom: 1px solid #e0eaf5; vertical-align: middle; }
  th { background: #d6e9ff; font-size: 0.85em; position: sticky; top: 0; }
  tr:last-child td { border-bottom: none; }
  tr:hover { background: #f5faff; }
  .avatar-cell img { width: 36px; height: 36px; border-radius: 50%; display: block; }
  .name a { color: #1c5299; text-decoration: none; font-weight: 700; }
  .name a:hover { text-decoration: underline; }
  .handle { color: #546580; font-size: 0.8em; }
  .job strong { font-size: 1.05em; }
  .job .tag { font-size: 0.8em; color: #546580; margin-top: 0.1em; }
  .cognitive { font-family: ui-monospace, monospace; font-size: 0.8em; }
  .cog { display: inline-block; margin-right: 0.4em; padding: 0.1em 0.4em; background: #f0f4f8; border-radius: 3px; }
  .conf { font-size: 0.8em; color: #546580; }
  .pair { font-weight: 700; color: #1c5299; }
  .score { text-align: right; font-family: ui-monospace, monospace; font-size: 1.3em; font-weight: 700; }
  .score .unit { font-size: 0.6em; color: #999; font-weight: 400; }
  .score-label { font-size: 0.6em; color: #546580; font-weight: 400; }
  .skipped { color: #546580; font-size: 0.9em; }
</style>
</head>
<body>
<h1>@${esc(ownerHandle)} のフォロー相手の気質診断</h1>
<div class="meta">
  生成日時: ${esc(generatedAt.toLocaleString('ja-JP'))}<br>
  対象: ${rows.length} 人中 ${ok.length} 人を診断 (最低 ${DIAGNOSIS_MIN_POST_COUNT} 投稿未満はスキップ)<br>
  ${ownerArchetype ? `基準の気質: <strong>${esc(jobDisplayName(ownerArchetype, 'default'))}</strong> (${esc(ownerArchetype)})` : '基準の気質: 未指定'}
</div>

<div class="summary">
  <h2>ジョブ分布</h2>
  <ul class="dist">
    ${distRows.map(([k, v]) => `<li><strong>${v}</strong> ${esc(k)}</li>`).join('')}
  </ul>
</div>

<h2>診断結果 (${ok.length} 人)</h2>
<table>
  <thead>
    <tr>
      <th></th>
      <th>ユーザー</th>
      <th>ジョブ</th>
      <th>気質 Top 3</th>
      <th>信頼度</th>
      <th>気質の関係</th>
      <th>相性</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>

${skippedHtml}

<p class="meta" style="margin-top: 2em;">
  Generated by <a href="https://github.com/kojira/aozoraquest">aozoraquest</a> diagnose-follows script.
</p>
</body>
</html>`;
}

async function main() {
  const targetHandle = process.argv[2] ?? 'kojira.io';
  const maxFollows = Number(process.argv[3] ?? '0') || Infinity; // 0 or missing = no limit
  const outFile = process.argv[4] ?? path.join(repoRoot, `diagnose-follows-${targetHandle.replace(/[^a-z0-9]/gi, '_')}.html`);

  console.log(`Target: ${targetHandle}`);
  console.log(`Loading ${EMBEDDING_MODEL_ID} ...`);
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, { dtype: EMBEDDING_DTYPE });
  const protos = await loadPrototypes();
  console.log(`Prototypes loaded. Top-N = ${DIAGNOSIS_TOP_N}`);

  // Try to diagnose owner first to get their archetype for pair relation
  let ownerArchetype: Archetype | null = null;
  try {
    console.log(`Diagnosing owner @${targetHandle} ...`);
    const ownerPosts = await fetchUserPosts(targetHandle, DIAGNOSIS_POST_LIMIT);
    if (ownerPosts.length >= DIAGNOSIS_MIN_POST_COUNT) {
      const vecs: Float32Array[] = [];
      for (const p of ownerPosts) {
        const emb = await extractor(p.text, { pooling: 'mean', normalize: true });
        vecs.push(emb.data as Float32Array);
      }
      const r = diagnose(vecs, protos, ownerPosts.length, new Date(), { timestamps: ownerPosts.map((p) => p.at) });
      if ('archetype' in r) {
        ownerArchetype = r.archetype;
        console.log(`  owner archetype: ${ownerArchetype} (${jobDisplayName(ownerArchetype, 'default')})`);
      }
    }
  } catch (e) {
    console.warn(`owner diagnosis failed: ${(e as Error).message}`);
  }

  console.log(`Fetching follows ...`);
  const allFollows = await fetchAllFollows(targetHandle);
  const follows = isFinite(maxFollows) ? allFollows.slice(0, maxFollows) : allFollows;
  console.log(`Found ${allFollows.length} follows, diagnosing ${follows.length}.`);

  const rows: DiagnosisRow[] = [];
  for (let i = 0; i < follows.length; i++) {
    const t = follows[i]!;
    process.stdout.write(`[${i + 1}/${follows.length}] @${t.handle} (${t.displayName}) ... `);
    try {
      const posts = await fetchUserPosts(t.handle, DIAGNOSIS_POST_LIMIT);
      if (posts.length < DIAGNOSIS_MIN_POST_COUNT) {
        console.log(`skip (${posts.length} posts)`);
        rows.push({ target: t, status: 'insufficient', postCount: posts.length });
        continue;
      }
      const vecs: Float32Array[] = [];
      for (const p of posts) {
        const emb = await extractor(p.text, { pooling: 'mean', normalize: true });
        vecs.push(emb.data as Float32Array);
      }
      const r = diagnose(vecs, protos, posts.length, new Date(), { timestamps: posts.map((p) => p.at) });
      if ('insufficient' in r) {
        console.log(`insufficient (${r.postCount})`);
        rows.push({ target: t, status: 'insufficient', postCount: r.postCount });
        continue;
      }
      console.log(`${jobDisplayName(r.archetype, 'default')} (${r.confidence})`);
      rows.push({ target: t, status: 'ok', result: r });
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`error: ${msg}`);
      rows.push({ target: t, status: 'error', error: msg });
    }
  }

  const html = renderHtml(targetHandle, ownerArchetype, rows, new Date());
  await fs.writeFile(outFile, html, 'utf-8');
  console.log(`\nHTML report written to: ${outFile}`);
  console.log(`Open: file://${outFile}`);
  // owner が使われたかどうかの通知
  void archetypePairRelation;
}

void main();
