// ローカルだけの AT Protocol ネットワーク (PLC + PDS)。D-LOCAL-PLAY-001 / #1018。
// @atproto/dev-env の部品 (TestPlc / TestPds) を使う。AppView は立てない (ワールドは PDS と edge だけで動く。
// SNS 機能 = タイムライン・プロフィール・投稿検索 はローカルでは空/失敗になるが、ワールドには不要)。
//
// 状態は .state/ に残す (再起動しても同じアカウント・同じ DID・同じ記録):
//   - PDS の sqlite と blob → .state/pds/
//   - PLC の操作ログ → .state/plc.json (dev-env の PLC はメモリなので、ここに書き出して起動時に戻す)
//   - PDS の PLC 回転鍵 / 復旧鍵 / DPoP secret → .state/keys.json (同じ鍵でないと既存 DID を更新できない)
// 全部消すと完全に初期化 (`pnpm local:world reset`)。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TestPlc, TestPds, mockNetworkUtilities } from '@atproto/dev-env';
import { Secp256k1Keypair, parseDidKey, formatMultikey } from '@atproto/crypto';
import http from 'node:http';
import { PLC_PORT, PLC_INTERNAL_PORT, PDS_PORT, STATE_DIR } from './ports.mjs';

const PDS_DIR = path.join(STATE_DIR, 'pds');
const PLC_FILE = path.join(STATE_DIR, 'plc.json');
const KEYS_FILE = path.join(STATE_DIR, 'keys.json');

fs.mkdirSync(path.join(PDS_DIR, 'blobs'), { recursive: true });

async function loadKeys() {
  if (fs.existsSync(KEYS_FILE)) return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  const rotation = await Secp256k1Keypair.create({ exportable: true });
  const recovery = await Secp256k1Keypair.create();
  const keys = {
    plcRotationKeyHex: Buffer.from(await rotation.export()).toString('hex'),
    recoveryDidKey: recovery.did(),
    dpopSecret: crypto.randomBytes(32).toString('hex'),
  };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return keys;
}

/** PLC のメモリ DB を .state/plc.json と同期する。起動時は保存した操作を**順に入れ直し** (検証・CID 計算は
 *  PLC 自身がやる)、以後は操作が増えるたびに書き出す。 */
async function persistPlc(plc) {
  const db = plc.server.ctx.db;
  const add = db.validateAndAddOp.bind(db);
  const log = fs.existsSync(PLC_FILE) ? JSON.parse(fs.readFileSync(PLC_FILE, 'utf8')) : [];
  for (const { did, op } of log) await add(did, op);
  db.validateAndAddOp = async (did, op) => {
    await add(did, op);
    log.push({ did, op });
    fs.writeFileSync(PLC_FILE, JSON.stringify(log));
  };
}

/**
 * PLC の前に置く小さな変換口 (PLC_PORT)。dev-env が使う @did-plc/server 0.0.1 (2023) は DID document の
 * 鍵を旧形式 (EcdsaSecp256k1VerificationKey2019 + 非圧縮の生鍵) で返すが、いまの plc.directory は
 * Multikey (multicodec 付き圧縮鍵) で返し、edge はそちらだけを読む。同じ PLC の `/<did>/data` にある
 * did:key から Multikey を組み直して返す。それ以外の経路はそのまま中継する。
 */
async function startPlcFront(innerUrl) {
  const server = http.createServer(async (req, res) => {
    try {
      const upstream = await fetch(`${innerUrl}${req.url}`, { method: req.method, headers: { 'content-type': req.headers['content-type'] ?? 'application/json' }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req) });
      let body = Buffer.from(await upstream.arrayBuffer());
      const m = req.method === 'GET' && /^\/(did:plc:[a-z2-7]+)$/.exec(decodeURIComponent(req.url ?? '')); // edge は %3A で送る
      if (m && upstream.ok) {
        const doc = JSON.parse(body.toString('utf8'));
        const data = await (await fetch(`${innerUrl}/${m[1]}/data`)).json();
        doc['@context'] = ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/multikey/v1', 'https://w3id.org/security/suites/secp256k1-2019/v1'];
        doc.verificationMethod = Object.entries(data.verificationMethods ?? {}).map(([id, didKey]) => ({ id: `${m[1]}#${id}`, type: 'Multikey', controller: m[1], publicKeyMultibase: compressedMultikey(String(didKey)) }));
        body = Buffer.from(JSON.stringify(doc));
      }
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'access-control-allow-origin': '*' });
      res.end(body);
    } catch (e) {
      res.writeHead(502).end(String(e));
    }
  });
  await new Promise((r) => server.listen(PLC_PORT, '127.0.0.1', r));
  return server;
}

/** did:key (dev-env の PLC は非圧縮で持つことがある) → 圧縮した Multikey (plc.directory と同じ形)。 */
function compressedMultikey(didKey) {
  const { jwtAlg, keyBytes } = parseDidKey(didKey);
  return formatMultikey(jwtAlg, keyBytes);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const keys = await loadKeys();
const plc = await TestPlc.create({ port: PLC_INTERNAL_PORT });
await persistPlc(plc);
const plcFront = await startPlcFront(plc.url);
const pds = await TestPds.create({
  port: PDS_PORT,
  didPlcUrl: plc.url,
  dataDirectory: PDS_DIR,
  blobstoreDiskLocation: path.join(PDS_DIR, 'blobs'),
  plcRotationKeyK256PrivateKeyHex: keys.plcRotationKeyHex,
  recoveryDidKey: keys.recoveryDidKey,
  dpopSecret: keys.dpopSecret,
  // ハンドルは <name>.test (dev-env の既定)。AppView は無い (= app.bsky.* は 「appview.invalid」に飛んで失敗する)。
});
mockNetworkUtilities(pds);

console.log(`[local-world] PLC http://localhost:${PLC_PORT} (中身は ${plc.url})`);
console.log(`[local-world] PDS ${pds.url} (OAuth 認可サーバーも同じ)`);
fs.writeFileSync(path.join(STATE_DIR, 'network.ready'), String(Date.now()));

const stop = async () => {
  try { fs.rmSync(path.join(STATE_DIR, 'network.ready'), { force: true }); } catch { /* ignore */ }
  await pds.close().catch(() => {});
  plcFront.close();
  await plc.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
