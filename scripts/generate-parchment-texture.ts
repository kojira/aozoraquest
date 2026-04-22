/**
 * scripts/generate-parchment-texture.ts
 *
 * カード背景に使う羊皮紙テクスチャを 6 レアリティ × 2 バリエーションで
 * Gemini Image API で生成する。レア度が上がるほど高級感が出るよう prompt を
 * 段階的に強める。
 *
 * 出力: docs/card-art-drafts/parchment-{rarity}-{1|2}.jpg
 * 採用後のコピー先: apps/web/public/card-art/parchment-{rarity}.jpg
 *
 * 使い方:
 *   pnpm tsx scripts/generate-parchment-texture.ts
 *   pnpm tsx scripts/generate-parchment-texture.ts --force
 *   pnpm tsx scripts/generate-parchment-texture.ts --only ur,ssr
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DRAFT_DIR = path.join(REPO_ROOT, 'docs/card-art-drafts');

const MODEL = 'gemini-3.1-flash-image-preview' as const;

export const RARITIES = ['common', 'uncommon', 'rare', 'srare', 'ssr', 'ur'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  srare: 'Sレア',
  ssr: 'SSR',
  ur: 'UR',
};

const BASE_DIRECTIVES = [
  'A blank medieval parchment paper texture for a trading card background, portrait orientation 3:4.',
  'No lettering, no drawings, no borders, no frames, no overlaid text, no objects, no people.',
  'Just the paper surface as if freshly prepared and ready to be written on.',
  'Photorealistic, high detail, soft natural lighting.',
].join(' ');

export const RARITY_PROMPTS: Record<Rarity, string> = {
  common: [
    BASE_DIRECTIVES,
    'Aesthetic: a rough, well-worn commoner\'s parchment.',
    'Muted cream and dusty tan tones, visible coarse fibers, random dark mottling,',
    'a few small old stains and faint crease lines, edges slightly rough and earth-darkened.',
    'Humble, utilitarian feel. No ornamentation. Neutral palette.',
  ].join(' '),

  uncommon: [
    BASE_DIRECTIVES,
    'Aesthetic: a reasonably preserved parchment of a traveling adventurer.',
    'Warm honey and wheat tones, cleaner fiber grain than rough commoner paper,',
    'subtle ink drop marks in the margins, gently burnt corners.',
    'A hint of carefulness. Simple but well-kept. No metallic elements.',
  ].join(' '),

  rare: [
    BASE_DIRECTIVES,
    'Aesthetic: a fine vellum used in a temple scriptorium.',
    'Even cream base with a faint cool undertone, very fine smooth fiber grain,',
    'subtly iridescent shimmer in the surface fibers, delicate watermark pattern barely visible,',
    'soft gradient between the center and the edges. Clean, refined. Still no metallic foil yet.',
  ].join(' '),

  srare: [
    BASE_DIRECTIVES,
    'Aesthetic: a noble house parchment with a hint of luxury.',
    'Rich ivory and warm gold-touched tones, very even grain, scattered subtle gold-leaf flecks',
    'gently embedded in the fibers (not overwhelming), a faint damask-like watermark at low opacity,',
    'elegantly darkened edges with a hint of vintage gilt. Tasteful, understated luxury.',
  ].join(' '),

  ssr: [
    BASE_DIRECTIVES,
    'Aesthetic: a royal decree vellum prepared with fine craftsmanship.',
    'Luminous cream base with warm golden highlights, a barely perceptible metallic sheen,',
    'distinct gold-leaf flecks scattered across the surface, an ornate damask watermark in the paper,',
    'edges gently darkened and touched with faint embossed filigree. Clearly high-grade, refined luxury.',
  ].join(' '),

  ur: [
    BASE_DIRECTIVES,
    'Aesthetic: an illuminated manuscript page from a jeweled royal codex.',
    'Radiant cream and pale-gold base with a soft pearlescent shimmer, fine silk-like fibers,',
    'visible gold-leaf particles and fine embossed filigree patterns faintly present in the surface,',
    'corners with faint ghosted illuminations of intricate gold-thread motifs (still no text or figures),',
    'a slight iridescent halo. Maximum luxurious feel, but still a blank surface ready to be written on.',
  ].join(' '),
};

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: .env に GEMINI_API_KEY を設定してください');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface GeneratedImage { bytes: Buffer; ext: 'png' | 'jpg' | 'webp' }

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

function parseArgs(): { force: boolean; only: readonly Rarity[] | null } {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  let only: Rarity[] | null = null;
  const oi = argv.indexOf('--only');
  if (oi >= 0 && argv[oi + 1]) {
    const list = argv[oi + 1]!.split(',').map((s) => s.trim());
    const valid = list.filter((r): r is Rarity => (RARITIES as readonly string[]).includes(r));
    if (valid.length === 0) {
      console.error(`--only が不正: ${argv[oi + 1]}`);
      process.exit(1);
    }
    only = valid;
  }
  return { force, only };
}

function findExisting(rarity: Rarity, variant: 1 | 2): string | null {
  for (const ext of ['png', 'jpg', 'webp']) {
    const fn = `parchment-${rarity}-${variant}.${ext}`;
    if (existsSync(path.join(DRAFT_DIR, fn))) return fn;
  }
  return null;
}

async function buildGalleryParchment(): Promise<void> {
  const rows: string[] = [];
  for (const r of RARITIES) {
    const label = RARITY_LABEL[r];
    const f1 = findExisting(r, 1);
    const f2 = findExisting(r, 2);
    rows.push(`
    <tr>
      <th>
        <div class="rarity">${label}</div>
        <div class="rid">${r}</div>
      </th>
      <td>${f1 ? `<img src="${f1}" /><div class="fn">${f1}</div>` : '<span class=missing>—</span>'}</td>
      <td>${f2 ? `<img src="${f2}" /><div class="fn">${f2}</div>` : '<span class=missing>—</span>'}</td>
    </tr>`);
  }
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/><title>parchment drafts</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #2a241a; color: #e8ddc2; margin: 0; padding: 24px; }
  h1 { margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px; vertical-align: top; border-top: 1px solid rgba(255,255,255,0.1); }
  th { text-align: left; width: 180px; }
  .rarity { font-weight: 700; font-size: 20px; }
  .rid { color: #a99878; font-family: ui-monospace, monospace; font-size: 12px; }
  img { width: 380px; height: auto; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; display: block; }
  .fn { font-family: ui-monospace, monospace; font-size: 11px; color: #a99878; margin-top: 4px; }
  td { text-align: center; }
  .missing { color: #888; }
</style></head>
<body>
  <h1>parchment drafts (6 rarities × 2)</h1>
  <p>各レア度で好きな方を <code>apps/web/public/card-art/parchment-{rarity}.jpg</code> へコピー。</p>
  <table>${rows.join('')}</table>
</body></html>`;
  await fs.writeFile(path.join(DRAFT_DIR, 'parchment-gallery.html'), html);
  console.log(`[info] gallery → ${path.join(DRAFT_DIR, 'parchment-gallery.html')}`);
}

async function main() {
  await fs.mkdir(DRAFT_DIR, { recursive: true });
  const { force, only } = parseArgs();
  const targets: readonly Rarity[] = only ?? RARITIES;
  const total = targets.length * 2;
  const t0 = Date.now();
  console.log(`[info] target rarities: ${targets.join(',')}, total images: ${total}`);
  console.log(`[info] ETA: ${Math.ceil(total * 15 / 60)}-${Math.ceil(total * 30 / 60)} 分`);

  let ok = 0, skip = 0, fail = 0;
  for (const rarity of targets) {
    const prompt = RARITY_PROMPTS[rarity];
    for (const variant of [1, 2] as const) {
      if (!force && findExisting(rarity, variant)) { skip++; continue; }
      process.stdout.write(`  [${rarity}-${variant}] generating... `);
      try {
        const res = await ai.models.generateContent({ model: MODEL, contents: prompt });
        const img = extractImage(res);
        if (!img) { fail++; console.log('fail (no image)'); continue; }
        const out = path.join(DRAFT_DIR, `parchment-${rarity}-${variant}.${img.ext}`);
        await fs.writeFile(out, img.bytes);
        ok++;
        console.log(`ok (${(img.bytes.length / 1024).toFixed(0)} KB, ${img.ext})`);
      } catch (e) {
        fail++;
        console.log(`fail: ${(e as Error)?.message ?? e}`);
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  await buildGalleryParchment();
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== done in ${dt}s: ok=${ok} skip=${skip} fail=${fail}`);
}

void main();
