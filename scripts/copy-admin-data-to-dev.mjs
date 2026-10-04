#!/usr/bin/env node
// 管理データの dev 側への一回限りの複製 (#716)。docs/design/admin-env-d006.md が正本。Node 標準のみ。
// 本番 app.aozoraquest.{world,config}.<x> の各レコードを、同じ repo・同じ rkey の
// app.aozoraquest.dev.{world,config}.<x> へ「無ければ作る」。本番には書かない。
// 既定は dry-run (読むだけ・一覧を出す)。--execute の時だけ app password で createRecord する。
// blob 参照は同じ repo の blob をそのまま指すのでコピー後も有効。
const ADMIN_DID = process.env.ADMIN_DID ?? 'did:plc:47skrewud2vjha6o57wzzxjw';
const ROOT = 'app.aozoraquest';
export const SOURCE_COLLECTIONS = [
  ...['map', 'tileArt', 'monsters', 'items', 'shops', 'npcs', 'quests', 'jobs', 'interiors', 'scenario'].map((n) => `${ROOT}.world.${n}`),
  ...['flags', 'maintenance', 'bans', 'prompts'].map((n) => `${ROOT}.config.${n}`),
];
/** 本番 → dev の collection。dev 以外を返すことはない。 */
export function devCollectionOf(source) {
  if (!SOURCE_COLLECTIONS.includes(source)) throw new Error(`対象外の collection: ${source}`);
  return `${ROOT}.dev.${source.slice(ROOT.length + 1)}`;
}
/** 書き込み直前の検査: 書き先は必ず app.aozoraquest.dev.* (本番を書かない)。 */
export function assertDevTarget(collection) {
  if (!collection.startsWith(`${ROOT}.dev.`)) throw new Error(`dev 以外への書き込みを拒否: ${collection}`);
}
/** 本番の値を dev 用に写す ($type だけ dev の collection に合わせる)。 */
export function devRecord(value, devCollection) {
  return { ...value, $type: devCollection };
}

async function xrpc(pds, method, params, init) {
  const res = await fetch(`${pds}/xrpc/${method}${params ? `?${new URLSearchParams(params)}` : ''}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${res.status}: ${body.message ?? body.error}`), { xrpcError: body.error });
  return body;
}
async function listAll(pds, collection) {
  const out = [];
  let cursor;
  do {
    const page = await xrpc(pds, 'com.atproto.repo.listRecords', { repo: ADMIN_DID, collection, limit: '100', ...(cursor ? { cursor } : {}) });
    out.push(...page.records);
    cursor = page.records.length ? page.cursor : undefined;
  } while (cursor);
  return out;
}
const rkeyOf = (uri) => uri.split('/').pop();

async function main(argv) {
  const execute = argv.includes('--execute');
  const doc = await (await fetch(`https://plc.directory/${ADMIN_DID}`)).json();
  const pds = doc.service.find((s) => s.id === '#atproto_pds').serviceEndpoint.replace(/\/$/, '');
  console.log(`${execute ? 'EXECUTE' : 'DRY-RUN'} repo=${ADMIN_DID} pds=${pds}`);
  const plan = [];
  for (const source of SOURCE_COLLECTIONS) {
    const target = devCollectionOf(source);
    const existing = new Set((await listAll(pds, target)).map((r) => rkeyOf(r.uri)));
    for (const r of await listAll(pds, source)) {
      const rkey = rkeyOf(r.uri);
      const action = existing.has(rkey) ? 'skip (dev に既存)' : 'create';
      plan.push({ source, target, rkey, cid: r.cid, value: r.value, action });
      console.log(`${action.padEnd(16)} ${source}/${rkey} (cid ${r.cid}, ${JSON.stringify(r.value).length}B) → ${target}/${rkey}`);
    }
  }
  const creates = plan.filter((p) => p.action === 'create');
  console.log(`計 ${plan.length} 件 / 作成 ${creates.length} / スキップ ${plan.length - creates.length}`);
  if (!execute) { console.log('dry-run: 何も書いていない (--execute で作成)'); return; }
  const identifier = process.env.BLUESKY_ADMIN_IDENTIFIER, password = process.env.BLUESKY_ADMIN_APP_PASSWORD;
  if (!identifier || !password) throw new Error('--execute には BLUESKY_ADMIN_IDENTIFIER / BLUESKY_ADMIN_APP_PASSWORD が要る');
  const session = await xrpc(pds, 'com.atproto.server.createSession', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  if (session.did !== ADMIN_DID) throw new Error(`login DID ${session.did} が管理者 ${ADMIN_DID} と違う`);
  for (const p of creates) {
    assertDevTarget(p.target);
    // createRecord = 既存なら失敗する (上書きしない)。
    const res = await xrpc(pds, 'com.atproto.repo.createRecord', null, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({ repo: ADMIN_DID, collection: p.target, rkey: p.rkey, record: devRecord(p.value, p.target) }) });
    console.log(`作成 ${p.target}/${p.rkey} cid ${res.cid}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
