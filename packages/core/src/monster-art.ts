/**
 * **モンスターの絵は管理者 PDS の `world.monsterArt` レコードだけが正** (D-MONSTER-001 PR2)。
 *
 * レコードは `{ arts: [{ id: <species>, svg: "<g>…</g>" }] }`。svg は viewBox 0 0 100 100 の中身で、
 * 色の差し込み口を持てる (既定色つき。今の絵が種ごとに既定色を持つため):
 *   - `{{tint|#57b7ee}}`                       → tint ?? 既定色
 *   - `{{shade:0.86|#8fa08a}}`                 → shade(tint ?? 既定色, 0.86)
 *   - `{{ifTint:rgba(255,255,255,0.7)|#bfe6ff}}` → tint があれば前、無ければ後 (slime のハイライト)
 * tint は `#rrggbb` のときだけ差し込む (それ以外は「無い」と同じ)。
 *
 * 描画は web が `<image href="data:…">` で行う (画像として読む SVG は script も外部読み込みも動かない)。
 * 検証で `<script` / `on*=` / `href=` を弾くのは多重の防御。
 */

export class MonsterArtError extends Error {}

export interface MonsterArtDef {
  /** species (MonsterDef.species と同じキー)。 */
  id: string;
  svg: string;
}

/** 1 体の絵の上限 (UTF-8 のバイト数)。 */
const MAX_SVG_BYTES = 16 * 1024;
const HEX = /^#[0-9a-f]{6}$/i;
const SLOT = /\{\{([^{}]*)\}\}/g;
const SLOT_TINT = /^tint\|(#[0-9a-f]{6})$/i;
const SLOT_SHADE = /^shade:(\d+(?:\.\d+)?)\|(#[0-9a-f]{6})$/i;
const SLOT_IF_TINT = /^ifTint:([^|"<>]*)\|([^|"<>]*)$/;
const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/<script/i, '<script'],
  [/(^|[\s"'/])on[a-z]+\s*=/i, 'on*='],
  [/href\s*=/i, 'href='],
];

const arts = new Map<string, string>();

/** 全部の絵を検証して差し替える。**壊れた 1 枚で全体を落とす** (前の値を残す)。 */
export function setMonsterArts(list: readonly MonsterArtDef[]): void {
  const next = validateMonsterArts(list);
  arts.clear();
  for (const [id, svg] of next) arts.set(id, svg);
}

/** 検証だけ (適用しない)。edge の管理データ API が保存前に使う。 */
export function validateMonsterArts(list: readonly MonsterArtDef[]): ReadonlyMap<string, string> {
  if (!Array.isArray(list) || list.length === 0) throw new MonsterArtError('絵が 0 枚');
  const next = new Map<string, string>();
  for (const a of list) {
    if (!a || typeof a.id !== 'string' || a.id.trim() === '') throw new MonsterArtError('id が空');
    if (next.has(a.id)) throw new MonsterArtError(`id が重複 (${a.id})`);
    validateSvg(a.id, a.svg);
    next.set(a.id, a.svg);
  }
  return next;
}

/** 0 枚に戻す (テストの後片付け)。 */
export function clearMonsterArts(): void {
  arts.clear();
}

function validateSvg(id: string, svg: unknown): void {
  if (typeof svg !== 'string' || svg.trim() === '') throw new MonsterArtError(`${id}: svg が空`);
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) throw new MonsterArtError(`${id}: svg が 16KB を超える`);
  for (const [re, label] of FORBIDDEN) if (re.test(svg)) throw new MonsterArtError(`${id}: svg に ${label} を含む`);
  for (const m of svg.matchAll(SLOT)) {
    const slot = m[1]!;
    if (!SLOT_TINT.test(slot) && !SLOT_SHADE.test(slot) && !SLOT_IF_TINT.test(slot)) {
      throw new MonsterArtError(`${id}: 知らない差し込み口 {{${slot}}}`);
    }
  }
  if (/\{\{|\}\}/.test(svg.replace(SLOT, ''))) throw new MonsterArtError(`${id}: 閉じていない差し込み口`);
}

/** tint を暗く/明るくして陰影用の第 2 色を作る (旧 monster-svg の shade と同じ計算)。 */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * factor))));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** species の絵を tint で塗った完全な SVG 文字列。絵が無ければ null (呼び出し側は「?」を出す)。 */
export function monsterArtSvg(species: string, tint: string | undefined): string | null {
  const body = arts.get(species);
  if (body === undefined) return null;
  const t = tint && HEX.test(tint) ? tint : undefined;
  const filled = body.replace(SLOT, (_, slot: string) => {
    const tm = SLOT_TINT.exec(slot);
    if (tm) return t ?? tm[1]!;
    const sm = SLOT_SHADE.exec(slot);
    if (sm) return shade(t ?? sm[2]!, Number(sm[1]));
    const im = SLOT_IF_TINT.exec(slot)!;
    return t ? im[1]! : im[2]!;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${filled}</svg>`;
}

/** `<image href>` に渡す data URI (`#` / `%` / `"` を必ず逃がす)。絵が無ければ null。 */
export function monsterArtDataUri(species: string, tint: string | undefined): string | null {
  const svg = monsterArtSvg(species, tint);
  return svg === null ? null : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
