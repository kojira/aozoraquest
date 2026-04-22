/**
 * scripts/generate-card-art.ts
 *
 * Gemini 3.1 Flash Image Preview で 16 archetype × 2 バリエーション = 32 枚の
 * 背景イラストを生成し、docs/card-art-drafts/{archetype}-{1|2}.png に保存する。
 * 同時にユーザーが見比べて選ぶための簡易ギャラリー HTML も生成。
 *
 * 使い方:
 *   pnpm tsx scripts/generate-card-art.ts
 *   pnpm tsx scripts/generate-card-art.ts --force
 *   pnpm tsx scripts/generate-card-art.ts --only sage,mage
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES, JOB_NAMES, JOB_TAGLINES, promptFor, type Archetype } from './card-art-prompts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/card-art-drafts');
const GALLERY_HTML = path.join(OUT_DIR, 'gallery.html');

const MODEL = 'gemini-3.1-flash-image-preview' as const;

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function parseArgs(): { force: boolean; only: readonly Archetype[] | null } {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  let only: Archetype[] | null = null;
  const onlyIdx = argv.indexOf('--only');
  if (onlyIdx >= 0 && argv[onlyIdx + 1]) {
    const list = argv[onlyIdx + 1]!.split(',').map((s) => s.trim());
    const valid = list.filter((a): a is Archetype =>
      (ARCHETYPES as readonly string[]).includes(a),
    );
    if (valid.length === 0) {
      console.error(`--only の値が不正: ${argv[onlyIdx + 1]}`);
      process.exit(1);
    }
    only = valid;
  }
  return { force, only };
}

interface GeneratedImage {
  bytes: Buffer;
  ext: 'png' | 'jpg' | 'webp';
}

/** Gemini のレスポンスから先頭の画像を抽出し、mime から拡張子を決める。 */
function extractImage(res: unknown): GeneratedImage | null {
  const r = res as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  for (const cand of r.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const inline = part.inlineData;
      if (!inline?.data) continue;
      const mime = inline.mimeType ?? '';
      const ext: GeneratedImage['ext'] = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
        : mime.includes('webp') ? 'webp' : 'png';
      return { bytes: Buffer.from(inline.data, 'base64'), ext };
    }
  }
  return null;
}

async function generateOne(archetype: Archetype, variant: 1 | 2): Promise<GeneratedImage | null> {
  const prompt = promptFor(archetype, variant);
  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    return extractImage(res);
  } catch (e) {
    console.warn(`  [${archetype}-${variant}] generation failed:`, (e as Error)?.message ?? e);
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function findExisting(archetype: Archetype, variant: 1 | 2): string | null {
  for (const ext of ['png', 'jpg', 'webp']) {
    const fn = `${archetype}-${variant}.${ext}`;
    if (existsSync(path.join(OUT_DIR, fn))) return fn;
  }
  return null;
}

async function buildGallery(): Promise<void> {
  const rows: string[] = [];
  for (const a of ARCHETYPES) {
    const name = JOB_NAMES[a];
    const tagline = JOB_TAGLINES[a];
    const f1 = findExisting(a, 1);
    const f2 = findExisting(a, 2);
    rows.push(`
    <tr>
      <th>
        <div class="jobname">${name}</div>
        <div class="jobid">${a}</div>
        <div class="tagline">${tagline}</div>
      </th>
      <td>${f1 ? `<img src="${f1}" /><div class="fn">${f1}</div>` : '<span class=missing>—</span>'}</td>
      <td>${f2 ? `<img src="${f2}" /><div class="fn">${f2}</div>` : '<span class=missing>—</span>'}</td>
    </tr>`);
  }
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/><title>card-art drafts</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #2a241a; color: #e8ddc2; margin: 0; padding: 24px; }
  h1 { margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px; vertical-align: top; border-top: 1px solid rgba(255,255,255,0.1); }
  th { text-align: left; width: 180px; }
  .jobname { font-weight: 700; font-size: 18px; }
  .jobid { color: #a99878; font-family: ui-monospace, monospace; font-size: 12px; }
  .tagline { color: #c6b48c; font-size: 13px; margin-top: 4px; }
  img { width: 380px; height: auto; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; display: block; }
  .fn { font-family: ui-monospace, monospace; font-size: 11px; color: #a99878; margin-top: 4px; }
  td { text-align: center; }
  .missing { color: #888; }
</style></head>
<body>
  <h1>card-art drafts (16 × 2)</h1>
  <p>各アーキタイプの好きな方を <code>apps/web/public/card-art/{archetype}.png</code> へコピーしてください。</p>
  <table>${rows.join('')}</table>
</body></html>`;
  await fs.writeFile(GALLERY_HTML, html);
  console.log(`[info] gallery → ${GALLERY_HTML}`);
}

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { force, only } = parseArgs();
  const targets: readonly Archetype[] = only ?? ARCHETYPES;
  const t0 = Date.now();
  const total = targets.length * 2;
  console.log(`[info] target archetypes: ${targets.length}, total images: ${total}`);
  console.log(`[info] model: ${MODEL}`);
  console.log(`[info] output: ${OUT_DIR}`);
  console.log(`[info] ETA: ${Math.round(total * 8 / 60)}-${Math.round(total * 20 / 60)} 分 (1 枚 8-20 秒)`);

  let ok = 0, skip = 0, fail = 0;
  for (const archetype of targets) {
    for (const variant of [1, 2] as const) {
      // 既存 (拡張子問わず) があれば skip
      if (!force && findExisting(archetype, variant)) {
        skip++;
        continue;
      }
      process.stdout.write(`  [${archetype}-${variant}] generating... `);
      const img = await generateOne(archetype, variant);
      if (!img) { fail++; console.log('fail'); continue; }
      const out = path.join(OUT_DIR, `${archetype}-${variant}.${img.ext}`);
      await fs.writeFile(out, img.bytes);
      ok++;
      console.log(`ok (${(img.bytes.length / 1024).toFixed(0)} KB, ${img.ext})`);
      await sleep(800);
    }
  }
  await buildGallery();
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== done in ${dt}s: ok=${ok} skip=${skip} fail=${fail}`);
  console.log(`gallery: open ${GALLERY_HTML}`);
}

void main();
