#!/usr/bin/env node
// 文中の人物名を {c:id} に置き換える一回限りの移行 (D-CHAR-001 §3・§8)。Node 標準のみ。dev の管理データだけ。
// 置き換えは一覧表 (map JSON) に載せた行だけ。正規表現で全体を一括置換はしない。
//   map = { characters: [{ id, name }], rows: [{ record, id, field, from, to }] }
// 行は from が今の dev の値と 1 字でも違えば止める。to の表示 (トークンを名前にした文) が from と違っても止める。
// 書き込みは admin-data.mjs の get/put (dev エッジ・swapCid の CAS) を通す。既定は dry-run まで。
import { readFileSync } from 'node:fs';

/** 書く順。参照される人物を先に作る (D-CHAR-001 §3)。 */
export const APPLY_ORDER = ['characters', 'items', 'monsters', 'shops', 'npcs', 'interiors', 'quests', 'scenario', 'dialogue'];
/** レコードごとの一覧キー (admin-data.mjs の LIST_KEY と同じ)。 */
const LIST_KEY = { characters: 'characters', items: 'items', monsters: 'monsters', shops: 'shops', npcs: 'npcs', interiors: 'interiors', quests: 'quests', scenario: 'events', dialogue: 'scenes' };
const idOf = (record, v) => (record === 'shops' ? `(${v?.x}, ${v?.y})` : String(v?.id));
const TOKEN = /\{c:([^{}]*)\}/g;

/** プレイヤーに見える欄 (core の characterTextsInRecord と同じ欄) を [field, 文] で並べる。 */
function visibleFields(record, el) {
  const out = [];
  const one = (path, v) => { if (typeof v === 'string') out.push([path, v]); };
  const many = (path, vs) => { if (Array.isArray(vs)) vs.forEach((v, i) => one(`${path}[${i}]`, v)); };
  switch (record) {
    case 'npcs': one('name', el.name); many('lines', el.lines); (el.altLines ?? []).forEach((a, i) => many(`altLines[${i}].lines`, a?.lines)); break;
    case 'quests': one('title', el.title); many('intro', el.intro); many('done', el.done); many('progress', el.progress); one('objective.line', el.objective?.line); break;
    case 'scenario': one('notice', el.notice); break;
    case 'dialogue': (el.lines ?? []).forEach((l, i) => { one(`lines[${i}].speaker`, l?.speaker); one(`lines[${i}].text`, l?.text); }); break;
    case 'items': one('name', el.name); break;
    case 'monsters': one('name', el.name); one('intro', el.intro); break;
    case 'interiors': one('name', el.name); one('inn.name', el.inn?.name); one('shop.name', el.shop?.name); break;
    case 'shops': for (const k of Object.keys(el.keeper ?? {})) one(`keeper.${k}`, el.keeper[k]); break;
  }
  return out;
}

/** 名前 (terms のどれか) を含む欄の一覧。 */
export function candidates(record, value, terms) {
  const out = [];
  for (const el of value?.[LIST_KEY[record]] ?? []) {
    for (const [field, text] of visibleFields(record, el)) if (terms.some((t) => text.includes(t))) out.push({ record, id: idOf(record, el), field, from: text });
  }
  return out;
}

/** 表示と同じ置き換え (core の withCharacterNames と同じ。知らない id は id のまま)。 */
export function resolveTokens(text, characters) {
  const byId = new Map(characters.map((c) => [c.id, c.name]));
  return text.replace(TOKEN, (_m, id) => byId.get(id) ?? id);
}

const pathKeys = (field) => field.split('.').flatMap((part) => {
  const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
  if (!m) throw new Error(`欄のパスが不正: ${field}`);
  return [m[1], ...[...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]))];
});
const getPath = (obj, keys) => keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPath(obj, keys, v) {
  const parent = getPath(obj, keys.slice(0, -1));
  parent[keys[keys.length - 1]] = v;
}

/** 今の characters に map の人物を足す。同じ id で名前が違えば止める (改名は管理画面でする)。 */
function mergeCharacters(current, add) {
  const out = [...current];
  for (const c of add) {
    const old = out.find((x) => x.id === c.id);
    if (!old) out.push({ id: c.id, name: c.name });
    else if (old.name !== c.name) throw new Error(`人物 ${c.id} の名前が今の値 (${old.name}) と map (${c.name}) で違う`);
  }
  return out;
}

/** 1 レコードぶんの計画。value は変えず、置き換えた後の値 next と、適用した行・止めた行を返す。 */
export function planRecord(record, value, rows, characters) {
  const key = LIST_KEY[record];
  if (record === 'characters') return { next: { ...value, characters: mergeCharacters(value?.characters ?? [], characters) }, applied: [], stopped: [] };
  const next = structuredClone(value ?? { [key]: [] });
  const ids = new Set(characters.map((c) => c.id));
  const applied = [], stopped = [];
  for (const row of rows) {
    const el = (next[key] ?? []).find((v) => idOf(record, v) === row.id);
    const keys = pathKeys(row.field);
    const now = el ? getPath(el, keys) : undefined;
    const unknown = [...row.to.matchAll(TOKEN)].map((m) => m[1]).find((id) => !ids.has(id));
    const reason = !el ? '要素が無い'
      : now !== row.from ? `今の値と違う (今: ${JSON.stringify(now)})`
      : unknown !== undefined ? `人物 ${unknown} が characters に無い`
      : resolveTokens(row.to, characters) !== row.from ? `表示が元の文と違う (${resolveTokens(row.to, characters)})`
      : null;
    if (reason) { stopped.push({ ...row, reason }); continue; }
    setPath(el, keys, row.to);
    applied.push(row);
  }
  return { next, applied, stopped };
}

const strip = (v) => { const { updatedAt: _u, $type: _t, ...rest } = v ?? {}; return rest; };
const same = (a, b) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

/**
 * 一覧表を適用する。レコードごとに GET → 検証 (行の照合) → cid が同じかの再 GET → dry-run → PUT (CAS) → GET で比べる。
 * `request(method, name, body)` は admin-data.mjs の request (dev エッジ)。execute が false なら dry-run まで。
 */
export async function migrate({ map, request, execute, log = console.error }) {
  const characters = map.characters ?? [];
  const report = { applied: 0, stopped: [], records: [] };
  let finalChars = characters;
  for (const record of APPLY_ORDER) {
    const rows = (map.rows ?? []).filter((r) => r.record === record);
    if (record !== 'characters' && rows.length === 0) continue;
    if (record === 'characters' && characters.length === 0) continue;
    const first = await request('GET', record);
    const plan = planRecord(record, first.value, rows, finalChars);
    if (record === 'characters') finalChars = plan.next.characters;
    for (const s of plan.stopped) log(`止めた ${record} ${s.id} ${s.field}: ${s.reason}`);
    report.stopped.push(...plan.stopped);
    report.records.push({ record, applied: plan.applied.length, stopped: plan.stopped.length });
    if (same(first.value, plan.next)) { log(`${record}: 変更なし`); continue; }
    const again = await request('GET', record);
    if (again.cid !== first.cid) throw new Error(`${record}: 検証の間に cid が変わった (${first.cid} → ${again.cid})。やり直す`);
    await request('PUT', record, { value: plan.next, swapCid: first.cid, dryRun: true });
    log(`${record}: dry-run を通った (${plan.applied.length} 行${record === 'characters' ? `、人物 ${plan.next.characters.length}` : ''})`);
    if (!execute) continue;
    const put = await request('PUT', record, { value: plan.next, swapCid: first.cid });
    const after = await request('GET', record);
    if (!same(after.value, plan.next)) throw new Error(`${record}: 書いた後の値が計画と違う (cid ${after.cid})`);
    log(`${record}: 書いた (cid ${put.cid})`);
    report.applied += plan.applied.length;
  }
  return report;
}

const HELP = `使い方 (dev の管理データだけ):
  node scripts/migrate-character-tokens.mjs candidates <語,語,...> [record...]   候補を JSON で出す
  node scripts/migrate-character-tokens.mjs apply <map.json> [--execute]       既定は dry-run まで
  record: ${APPLY_ORDER.filter((r) => r !== 'characters').join(' | ')}`;

async function main(argv) {
  const { request } = await import('./admin-data.mjs');
  const [cmd, ...rest] = argv.filter((a) => a !== '--execute');
  if (cmd === 'candidates' && rest.length >= 1) {
    const terms = rest[0].split(',').filter(Boolean);
    const records = rest.length > 1 ? rest.slice(1) : APPLY_ORDER.filter((r) => r !== 'characters');
    const out = [];
    for (const r of records) out.push(...candidates(r, (await request('GET', r)).value, terms));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === 'apply' && rest.length === 1) {
    const report = await migrate({ map: JSON.parse(readFileSync(rest[0], 'utf8')), request, execute: argv.includes('--execute') });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(HELP);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
