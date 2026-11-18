#!/usr/bin/env node
// dev の管理レコードを本番へ昇格する one-shot (D-MONSTER-001, D-DIALOGUE-006)。Node 標準のみ。
// 対象は admin-data.mjs の NAMES と同じ 10 種。ワールド公開で items〜story も本番へ移すため広げた
// (map / tileArt は本番と同じ中身、jobs はどちらにも無いので含めない)。書く順は core の読み込み順に合わせる。
// 書く前の core 検証はしない (core は tsx が要り Node 標準だけでは読めない)。--execute の前に手で検証する。
// **本番への書き込み手段。実行 (--execute) にはユーザーの承認が要る。**
// 既定は dry-run (差分の要約だけ)。--execute と BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が
// 揃ったときだけ書く。既存の本番値は --backup-dir (必須) に退避し、CAS (swapRecord) で書く。
// --restore <file> は退避ファイルを同じ検査・CAS で書き戻す。
// **画像は dev と共有しない** (D-ENV-002、オーナー決定 2026-11-18「本番リリース時にコピーして使ってください」)。
// レコードが参照する blob を全部ダウンロードし、本番の印を足したバイト列 (= 別の CID) で上げ直し、
// 本番に書くレコードの参照をその CID に書き換える。同じ dev blob からは毎回同じ本番 blob になる (冪等)。
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

export const ADMIN_DID = process.env.ADMIN_DID ?? 'did:plc:47skrewud2vjha6o57wzzxjw';
const ROOT = 'app.aozoraquest';
const RKEY = 'self';
/** 昇格してよいレコードだけ (汎用の昇格ツールにしない)。並びは core の読み込み順 (ADMIN_WORLD_RECORDS)。 */
export const PROMOTE_NAMES = ['characters', 'monsters', 'monsterArt', 'items', 'casino', 'shops', 'npcs', 'interiors', 'quests', 'scenario', 'story', 'dialogue'];
/** 要約で件数を数える一覧キー (admin-data.mjs の LIST_KEY と同じ)。 */
const LIST_KEY = { characters: 'characters', monsters: 'monsters', monsterArt: 'arts', items: 'items', shops: 'shops', npcs: 'npcs', interiors: 'interiors', quests: 'quests', scenario: 'events', story: 'placedItems', dialogue: 'scenes' };

export const devCollection = (name) => `${ROOT}.dev.world.${name}`;
export const prodCollection = (name) => `${ROOT}.world.${name}`;

/** 書き先は必ず app.aozoraquest.world.(PROMOTE_NAMES のどれか)。 */
export function assertProdTarget(collection) {
  if (!PROMOTE_NAMES.some((n) => collection === prodCollection(n))) throw new Error(`書き先が許可されていない: ${collection}`);
}
/** ログインした DID が管理者であること。 */
export function assertAdminDid(did) {
  if (did !== ADMIN_DID) throw new Error(`login DID ${did} が管理者 ${ADMIN_DID} と違う`);
}

export function parseArgs(argv) {
  const opts = { names: [], execute: false, backupDir: null, restore: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--execute') opts.execute = true;
    else if (a === '--backup-dir') opts.backupDir = argv[++i] ?? null;
    else if (a === '--restore') opts.restore = argv[++i] ?? null;
    else if (a.startsWith('--')) throw new Error(`知らない引数: ${a}`);
    else opts.names.push(a);
  }
  if (!opts.backupDir) throw new Error('--backup-dir <dir> は必須');
  if (!opts.restore) {
    if (opts.names.length === 0) throw new Error(`name を 1 つ以上 (${PROMOTE_NAMES.join(' | ')})`);
    for (const n of opts.names) if (!PROMOTE_NAMES.includes(n)) throw new Error(`対象外の name: ${n}`);
  }
  return opts;
}

/** 本番へ書く計画 1 件。prev が無ければ swapRecord=null (新規)、あれば既存 cid で CAS。 */
export function planFor(name, dev, prod) {
  if (!dev) throw new Error(`dev に ${name} が無い`);
  const collection = prodCollection(name);
  assertProdTarget(collection);
  const listKey = LIST_KEY[name];
  return {
    name, collection,
    swapRecord: prod?.cid ?? null,
    record: { ...dev.value, $type: collection },
    summary: `${name}: dev ${dev.cid} (${dev.value?.[listKey]?.length ?? 0} 件) → 本番 ${prod ? `${prod.cid} (${prod.value?.[listKey]?.length ?? 0} 件) を上書き` : '新規'}`,
    backup: prod ? { name, collection, cid: prod.cid, value: prod.value } : null,
  };
}

/** 退避ファイルを書く (既存の本番値が無ければ書かない)。返り値はパス。 */
export function writeBackup(dir, backup, now = new Date()) {
  if (!backup) return null;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `backup-${backup.name}-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 2));
  return file;
}

/** 退避ファイル → 書き戻しの計画 (今の本番 cid で CAS)。 */
export function restorePlan(file, current) {
  const b = JSON.parse(readFileSync(file, 'utf8'));
  assertProdTarget(b.collection);
  if (!PROMOTE_NAMES.includes(b.name) || b.collection !== prodCollection(b.name)) throw new Error('退避ファイルの name / collection が合わない');
  return { name: b.name, collection: b.collection, swapRecord: current?.cid ?? null, record: { ...b.value, $type: b.collection }, summary: `restore ${b.name}: ${b.cid} を書き戻す`, backup: current ? { name: b.name, collection: b.collection, cid: current.cid, value: current.value } : null };
}

// ─── 画像 (blob) の本番コピー (D-ENV-002) ───

/** NPC 画像の容量上限 (core の NPC_IMAGE_BYTES と同じ値。scripts は TS を読めないので複製し、テストで一致を見る)。 */
export const NPC_IMAGE_BYTES = { sprite: 100 * 1024, portrait: 1024 * 1024 };
/** 本番コピーの印。WebP は末尾に未知の RIFF chunk `AQPR`、PNG は IEND の前に私用の補助 chunk `aqPr`。
 *  どちらも仕様上デコーダが読み飛ばす chunk で、画像の中身は変わらない。 */
export const PROD_MARK = new TextEncoder().encode('aozoraquest:prod');

const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
const u32le = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u32be = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, false); return b; };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** 印を足したバイト列。同じ入力には同じ出力 (決定的)。WebP / PNG 以外は止める。 */
export function markProdImage(bytes, mimeType) {
  if (mimeType === 'image/webp') {
    if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') throw new Error('WebP ではない');
    const riffEnd = 8 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    if (riffEnd !== bytes.length) throw new Error('WebP の RIFF の大きさが合わない');
    const out = concat(bytes, new TextEncoder().encode('AQPR'), u32le(PROD_MARK.length), PROD_MARK); // PROD_MARK は偶数長 (詰め物不要)
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return out;
  }
  if (mimeType === 'image/png') {
    const iend = bytes.length - 12;
    if (ascii(bytes, 1, 3) !== 'PNG' || ascii(bytes, iend + 4, 4) !== 'IEND') throw new Error('PNG ではない');
    const typeAndData = concat(new TextEncoder().encode('aqPr'), PROD_MARK);
    return concat(bytes.subarray(0, iend), u32be(PROD_MARK.length), typeAndData, u32be(crc32(typeAndData)), bytes.subarray(iend));
  }
  throw new Error(`本番コピーに対応していない画像形式: ${mimeType}`);
}

/** uploadBlob と同じ CID (CIDv1 / raw / sha256、base32 小文字)。上げる前に本番 CID を確かめる。 */
export function blobCid(bytes) {
  const raw = concat(new Uint8Array([1, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest());
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'; let out = 'b', bits = 0, v = 0;
  for (const byte of raw) { v = ((v << 8) | byte) & 0xffff; bits += 8; while (bits >= 5) { bits -= 5; out += alphabet[(v >>> bits) & 31]; } }
  if (bits) out += alphabet[(v << (5 - bits)) & 31];
  return out;
}

/** レコードの中の blob 参照 ({$type:'blob', ref:{$link}}) を全部集める。欄の名前で選ばない (形で探す)。 */
export function blobRefs(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((v, i) => blobRefs(v, [...path, i]));
  if (!value || typeof value !== 'object') return [];
  if (value.$type === 'blob') return [{ path, cid: value.ref?.$link, mimeType: value.mimeType, size: value.size }];
  return Object.entries(value).flatMap(([k, v]) => blobRefs(v, [...path, k]));
}

/** spriteImage の blob は sprite の上限、それ以外 (portraitImage / expressionImages) は portrait の上限。 */
const limitFor = (path) => (path.includes('spriteImage') ? NPC_IMAGE_BYTES.sprite : NPC_IMAGE_BYTES.portrait);

/**
 * 本番に書くレコードの blob を全部本番コピーに差し替える。`fetchBlob(cid)` で dev の blob のバイト列を得る。
 * 返り値の uploads は上げる本番 blob (CID ごとに 1 つ)。dev の CID を 1 つでも残したら止める。
 */
export async function withProdBlobs(record, fetchBlob) {
  const refs = blobRefs(record);
  const devCids = new Set(refs.map((r) => r.cid));
  const copies = new Map();
  for (const r of refs) {
    if (copies.has(r.cid)) continue;
    const bytes = await fetchBlob(r.cid);
    if (blobCid(bytes) !== r.cid) throw new Error(`blob ${r.cid} の中身が CID と合わない`);
    const marked = markProdImage(bytes, r.mimeType);
    if (marked.length > limitFor(r.path)) throw new Error(`blob ${r.cid} は印を足すと容量の上限を超える`);
    copies.set(r.cid, { cid: blobCid(marked), bytes: marked, mimeType: r.mimeType });
  }
  const swap = (v) => {
    if (Array.isArray(v)) return v.map(swap);
    if (!v || typeof v !== 'object') return v;
    if (v.$type === 'blob') { const c = copies.get(v.ref.$link); return { ...v, ref: { $link: c.cid }, size: c.bytes.length }; }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
  };
  const out = swap(record);
  for (const r of blobRefs(out)) if (devCids.has(r.cid)) throw new Error(`本番のレコードが dev の blob ${r.cid} を指している`);
  return { record: out, uploads: [...new Map([...copies.values()].map((c) => [c.cid, c])).values()] };
}

async function xrpc(pds, method, params, init) {
  const res = await fetch(`${pds}/xrpc/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${res.status}: ${body.message ?? body.error}`), { xrpcError: body.error });
  return body;
}
async function getRecord(pds, collection) {
  try { return await xrpc(pds, 'com.atproto.repo.getRecord', { repo: ADMIN_DID, collection, rkey: RKEY }); }
  catch (e) { if (e.xrpcError === 'RecordNotFound') return null; throw e; }
}

async function main(argv) {
  const opts = parseArgs(argv);
  const doc = await (await fetch(`https://plc.directory/${ADMIN_DID}`)).json();
  const pds = doc.service.find((s) => s.id === '#atproto_pds').serviceEndpoint.replace(/\/$/, '');
  console.log(`${opts.execute ? 'EXECUTE' : 'DRY-RUN'} repo=${ADMIN_DID} pds=${pds}`);
  const plans = [];
  if (opts.restore) {
    const name = JSON.parse(readFileSync(opts.restore, 'utf8')).name;
    plans.push(restorePlan(opts.restore, await getRecord(pds, prodCollection(name))));
  } else {
    for (const name of opts.names) plans.push(planFor(name, await getRecord(pds, devCollection(name)), await getRecord(pds, prodCollection(name))));
  }
  const fetchBlob = async (cid) => {
    const res = await fetch(`${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: ADMIN_DID, cid })}`);
    if (!res.ok) throw new Error(`getBlob ${cid} ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  if (!opts.restore) {
    for (const p of plans) {
      const { record, uploads } = await withProdBlobs(p.record, fetchBlob);
      Object.assign(p, { record, uploads });
      if (uploads.length) p.summary += ` / 画像 ${uploads.length} 件を本番コピーにする`;
    }
  }
  for (const p of plans) console.log(p.summary);
  if (!opts.execute) { console.log('dry-run: 何も書いていない (--execute で書く。ユーザーの承認が要る)'); return; }
  const identifier = process.env.BLUESKY_ADMIN_IDENTIFIER, password = process.env.BLUESKY_ADMIN_APP_PASSWORD;
  if (!identifier || !password) throw new Error('--execute には BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が要る');
  const session = await xrpc(pds, 'com.atproto.server.createSession', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  assertAdminDid(session.did);
  for (const p of plans) {
    assertProdTarget(p.collection);
    for (const u of p.uploads ?? []) {
      const up = await xrpc(pds, 'com.atproto.repo.uploadBlob', null, { method: 'POST', headers: { 'content-type': u.mimeType, authorization: `Bearer ${session.accessJwt}` }, body: u.bytes });
      if (up.blob?.ref?.$link !== u.cid) throw new Error(`uploadBlob の CID ${up.blob?.ref?.$link} が ${u.cid} と違う`);
      console.log(`画像 ${u.cid} を上げた`);
    }
    const file = writeBackup(opts.backupDir, p.backup);
    if (file) console.log(`退避 ${file}`);
    const res = await xrpc(pds, 'com.atproto.repo.putRecord', null, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({ repo: ADMIN_DID, collection: p.collection, rkey: RKEY, record: p.record, swapRecord: p.swapRecord }) });
    console.log(`書いた ${p.collection} cid ${res.cid}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
