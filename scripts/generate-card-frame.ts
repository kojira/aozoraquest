/**
 * scripts/generate-card-frame.ts
 *
 * カード全体の「枠付き羊皮紙」を 6 レアリティ × 2 バリエーションで Gemini
 * Image API で生成する。枠はレアリティが上がるほど豪華になる (金箔・宝石・
 * 緻密な装飾) 構造。
 *
 * 出力: docs/card-art-drafts/frame-{rarity}-{1|2}.jpg (portrait 3:4 の 1 枚絵)
 * 採用後: apps/web/public/card-art/frame-{rarity}.jpg
 *
 * この画像は parchment.jpg の代わりに SVG カード全面の背景として使う。
 * 枠はジョブ背景 / タイトル / 型行 / 本文の上に重なる配置を想定しているため、
 * 「中央は空の羊皮紙、四隅と四辺に装飾」の構図を指定する。
 *
 * 使い方:
 *   pnpm tsx scripts/generate-card-frame.ts
 *   pnpm tsx scripts/generate-card-frame.ts --force
 *   pnpm tsx scripts/generate-card-frame.ts --only ssr,ur
 */

import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs/card-art-drafts');
const GALLERY = path.join(OUT_DIR, 'frame-gallery.html');

const MODEL = 'gemini-3.1-flash-image-preview' as const;

const RARITIES = ['common', 'uncommon', 'rare', 'srare', 'ssr', 'ur'] as const;
type Rarity = (typeof RARITIES)[number];

const LABEL: Record<Rarity, string> = {
  common: 'コモン',
  uncommon: 'アンコモン',
  rare: 'レア',
  srare: 'Sレア',
  ssr: 'SSR',
  ur: 'UR',
};

const BASE = [
  'A complete blank trading card frame, portrait orientation 3:4 aspect ratio.',
  'Aged parchment interior with a decorative border surrounding the edges (about 6-10% card width).',
  'The border is ornamental, running along all four edges, uniform in width.',
  'The decorative border is continuous and clearly distinguishes itself from the central blank parchment.',
  'The center (about 80% area) is empty blank aged parchment, no lettering, no pictures, no figures.',
  'Top-down flat view, fully symmetric, no perspective or 3D tilt.',
  'Photorealistic high-detail rendering, medieval illuminated manuscript aesthetic.',
  'No cards stacked, no background outside the card, no shadows, no text, no lettering, no numbers.',
].join(' ');

const RARITY_PROMPTS: Record<Rarity, string> = {
  common: [
    BASE,
    'Rarity: Common. The border is simple, austere sepia ink with a thin single line and',
    'minimal geometric patterns. Subdued earth tones only. No metallics. A humble commoner card.',
  ].join(' '),

  uncommon: [
    BASE,
    'Rarity: Uncommon. The border has fine ink patterns and a single thin accent line',
    'in muted brass, small corner flourishes in each of the four corners. Still restrained.',
    'Minimal shine.',
  ].join(' '),

  rare: [
    BASE,
    'Rarity: Rare. The border is an elegant ink frame with a thin silver-toned metallic',
    'accent line and delicate filigree corners. Light engraved filigree running along the edges.',
    'Tasteful, refined. No gold yet.',
  ].join(' '),

  srare: [
    BASE,
    'Rarity: S-Rare. The border is ornate with gold-touched filigree along the edges,',
    'vine-like motifs, subtle jewel-like accent stones at the four corners.',
    'Clearly luxurious but still restrained.',
  ].join(' '),

  ssr: [
    BASE,
    'Rarity: SSR. The border is very ornate gold-leaf ornamentation with intricate filigree,',
    'embossed corner cartouches, small gem-like inlays, a narrow secondary pearl-white band,',
    'and subtle luminous highlights. Obviously high-grade luxury.',
  ].join(' '),

  ur: [
    BASE,
    'Rarity: UR. The border is extremely ornate illuminated-manuscript style with dense',
    'gold-leaf filigree, pearlescent iridescent highlights, jeweled corner medallions with',
    'ruby and sapphire hints, interwoven gold thread motifs all along the edges, a soft',
    'halo of luminescence. Mythic, sacred, otherworldly luxury.',
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
    const fn = `frame-${rarity}-${variant}.${ext}`;
    if (existsSync(path.join(OUT_DIR, fn))) return fn;
  }
  return null;
}

async function buildGallery(): Promise<void> {
  const rows: string[] = [];
  for (const r of RARITIES) {
    const f1 = findExisting(r, 1);
    const f2 = findExisting(r, 2);
    rows.push(`
    <tr>
      <th>
        <div class="rarity">${LABEL[r]}</div>
        <div class="rid">${r}</div>
      </th>
      <td>${f1 ? `<img src="${f1}" /><div class="fn">${f1}</div>` : '<span class=missing>—</span>'}</td>
      <td>${f2 ? `<img src="${f2}" /><div class="fn">${f2}</div>` : '<span class=missing>—</span>'}</td>
    </tr>`);
  }
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"/><title>frame drafts</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #2a241a; color: #e8ddc2; margin: 0; padding: 24px; }
  h1 { margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 8px; vertical-align: top; border-top: 1px solid rgba(255,255,255,0.1); }
  th { text-align: left; width: 180px; }
  .rarity { font-weight: 700; font-size: 20px; }
  .rid { color: #a99878; font-family: ui-monospace, monospace; font-size: 12px; }
  img { width: 420px; height: auto; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; display: block; }
  .fn { font-family: ui-monospace, monospace; font-size: 11px; color: #a99878; margin-top: 4px; }
  td { text-align: center; }
  .missing { color: #888; }
</style></head>
<body>
  <h1>card frame drafts (6 rarities × 2)</h1>
  <p>各レア度で好きな方を <code>apps/web/public/card-art/frame-{rarity}.jpg</code> へコピー。</p>
  <table>${rows.join('')}</table>
</body></html>`;
  await fs.writeFile(GALLERY, html);
  console.log(`[info] gallery → ${GALLERY}`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const { force, only } = parseArgs();
  const targets: readonly Rarity[] = only ?? RARITIES;
  const total = targets.length * 2;
  const t0 = Date.now();
  console.log(`[info] target rarities: ${targets.join(',')} / ${total} images`);
  console.log(`[info] ETA: ${Math.ceil(total * 18 / 60)}-${Math.ceil(total * 30 / 60)} 分`);

  let ok = 0, skip = 0, fail = 0;
  for (const rarity of targets) {
    const prompt = RARITY_PROMPTS[rarity];
    for (const variant of [1, 2] as const) {
      if (!force && findExisting(rarity, variant)) { skip++; continue; }
      process.stdout.write(`  [frame-${rarity}-${variant}] generating... `);
      try {
        const res = await ai.models.generateContent({ model: MODEL, contents: prompt });
        const img = extractImage(res);
        if (!img) { fail++; console.log('fail (no image)'); continue; }
        const out = path.join(OUT_DIR, `frame-${rarity}-${variant}.${img.ext}`);
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
  await buildGallery();
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== done in ${dt}s: ok=${ok} skip=${skip} fail=${fail}`);
}

void main();
