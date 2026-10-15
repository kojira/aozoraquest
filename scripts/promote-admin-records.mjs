#!/usr/bin/env node
// dev の管理レコード monsters / monsterArt を本番へ昇格する one-shot (D-MONSTER-001)。Node 標準のみ。
// **本番への書き込み手段。実行 (--execute) にはユーザーの承認が要る。**
// 既定は dry-run (差分の要約だけ)。--execute と BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が
// 揃ったときだけ書く。既存の本番値は --backup-dir (必須) に退避し、CAS (swapRecord) で書く。
// --restore <file> は退避ファイルを同じ検査・CAS で書き戻す。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_DID = process.env.ADMIN_DID ?? 'did:plc:47skrewud2vjha6o57wzzxjw';
const ROOT = 'app.aozoraquest';
const RKEY = 'self';
/** 昇格してよいレコードだけ (汎用の昇格ツールにしない)。 */
export const PROMOTE_NAMES = ['monsters', 'monsterArt'];

export const devCollection = (name) => `${ROOT}.dev.world.${name}`;
export const prodCollection = (name) => `${ROOT}.world.${name}`;

/** 書き先は必ず app.aozoraquest.world.(monsters|monsterArt)。 */
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
  const listKey = name === 'monsters' ? 'monsters' : 'arts';
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
  for (const p of plans) console.log(p.summary);
  if (!opts.execute) { console.log('dry-run: 何も書いていない (--execute で書く。ユーザーの承認が要る)'); return; }
  const identifier = process.env.BLUESKY_ADMIN_IDENTIFIER, password = process.env.BLUESKY_ADMIN_APP_PASSWORD;
  if (!identifier || !password) throw new Error('--execute には BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が要る');
  const session = await xrpc(pds, 'com.atproto.server.createSession', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  assertAdminDid(session.did);
  for (const p of plans) {
    assertProdTarget(p.collection);
    const file = writeBackup(opts.backupDir, p.backup);
    if (file) console.log(`退避 ${file}`);
    const res = await xrpc(pds, 'com.atproto.repo.putRecord', null, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({ repo: ADMIN_DID, collection: p.collection, rkey: RKEY, record: p.record, swapRecord: p.swapRecord }) });
    console.log(`書いた ${p.collection} cid ${res.cid}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
