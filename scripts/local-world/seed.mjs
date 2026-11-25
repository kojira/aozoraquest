// ローカル環境にアカウントとワールドを入れる。何度流してもよい (無いものだけ作る / world.* は上書き)。
// D-LOCAL-PLAY-001 / #1018。
//
//   node seed.mjs                 … アカウント作成 + dev の world.* を写す + edge の変数を書く
//   node seed.mjs --fresh-player  … プレイヤーを作り直す (新しい DID = 最初から遊べる)
//
// **dev / 本番には書かない**: dev の管理者 repo は公開レコードを無認証で**読むだけ**。書き込みは
// すべてローカル PDS (http://localhost:2583) に向かう (下の assertLocal が送信先を検査する)。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ACCOUNTS, ADMIN_PREFIX, DEV_ADMIN_DID, EDGE_DID, EDGE_URL, HERE, PDS_URL, PLC_URL, STATE_DIR, WEB_URL } from './ports.mjs';
import { generateP256Jwk } from './jwk.mjs';
import { ADMIN_PASSWORD } from '@atproto/dev-env';

const ACCOUNTS_FILE = path.join(STATE_DIR, 'accounts.json');
const WORLD_RECORDS = ['characters', 'map', 'tileArt', 'monsters', 'monsterArt', 'items', 'casino', 'shops', 'npcs', 'jobs', 'interiors', 'quests', 'scenario', 'story', 'dialogue'];

function assertLocal(url) {
  const u = new URL(url);
  if (!(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) throw new Error(`ローカル以外への書き込みを拒否: ${url}`);
}

async function xrpc(base, nsid, { params, body, token, raw, contentType } = {}) {
  const url = `${base}/xrpc/${nsid}${params ? `?${new URLSearchParams(params)}` : ''}`;
  const write = body !== undefined || raw !== undefined;
  if (write) assertLocal(url);
  const res = await fetch(url, {
    method: write ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(write ? { 'content-type': contentType ?? 'application/json' } : {}) },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw Object.assign(new Error(`${nsid} ${res.status}: ${json.message ?? json.error ?? text}`), { error: json.error });
  return json;
}

function loadAccounts() {
  return fs.existsSync(ACCOUNTS_FILE) ? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')) : {};
}
function saveAccounts(a) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(a, null, 2), { mode: 0o600 });
}

/** アカウントを作る (既にあればログインだけ)。パスワードは .state/accounts.json に保存 (ローカル専用)。 */
async function ensureAccount(saved, key) {
  const spec = ACCOUNTS[key];
  const rec = saved[key];
  if (rec) {
    try {
      const s = await xrpc(PDS_URL, 'com.atproto.server.createSession', { body: { identifier: rec.did, password: rec.password } });
      return { ...rec, accessJwt: s.accessJwt };
    } catch {
      delete saved[key]; // PDS を消した後など → 作り直す
    }
  }
  // 作り直し (--fresh-player) でも同じハンドルを使う (古いアカウントは先に消している)。
  const password = crypto.randomBytes(12).toString('base64url');
  const r = await xrpc(PDS_URL, 'com.atproto.server.createAccount', { body: { handle: spec.handle, email: spec.email, password } });
  saved[key] = { handle: spec.handle, did: r.did, password };
  saveAccounts(saved);
  console.log(`作成 ${key}: ${spec.handle} ${r.did}`);
  return { ...saved[key], accessJwt: r.accessJwt };
}

/** ローカル PDS の管理 API でアカウントを消す (dev-env の管理パスワードは dev-env が公開している既定値)。 */
async function adminDelete(did) {
  const res = await fetch(`${PDS_URL}/xrpc/com.atproto.admin.deleteAccount`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64') },
    body: JSON.stringify({ did }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`admin.deleteAccount ${res.status}`);
}

async function devAdminPds() {
  const doc = await (await fetch(`https://plc.directory/${DEV_ADMIN_DID}`)).json();
  return doc.service.find((s) => s.id === '#atproto_pds').serviceEndpoint.replace(/\/$/, '');
}

/** dev の world.* を読み (無認証)、blob ごとローカル管理者 repo に put する。 */
async function copyWorld(admin) {
  const devPds = await devAdminPds();
  const blobCache = new Map();
  let total = 0;
  for (const name of WORLD_RECORDS) {
    const collection = `${ADMIN_PREFIX}.world.${name}`;
    const list = await xrpc(devPds, 'com.atproto.repo.listRecords', { params: { repo: DEV_ADMIN_DID, collection, limit: '100' } });
    for (const r of list.records) {
      const rkey = r.uri.split('/').pop();
      const value = await reuploadBlobs(r.value, devPds, admin, blobCache);
      await xrpc(PDS_URL, 'com.atproto.repo.putRecord', { token: admin.accessJwt, body: { repo: admin.did, collection, rkey, record: value, validate: false } });
      total++;
      console.log(`写した ${collection}/${rkey} (${JSON.stringify(value).length}B)`);
    }
    if (!list.records.length) console.log(`dev に無い ${collection} (同梱の既定で動く)`);
  }
  console.log(`world.* ${total} 件 / blob ${blobCache.size} 個`);
}

async function reuploadBlobs(value, devPds, admin, cache) {
  if (Array.isArray(value)) return Promise.all(value.map((v) => reuploadBlobs(v, devPds, admin, cache)));
  if (!value || typeof value !== 'object') return value;
  if (value.$type === 'blob' && value.ref?.$link) {
    const cid = value.ref.$link;
    if (!cache.has(cid)) {
      const res = await fetch(`${devPds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: DEV_ADMIN_DID, cid })}`);
      if (!res.ok) throw new Error(`getBlob ${cid} ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const up = await xrpc(PDS_URL, 'com.atproto.repo.uploadBlob', { token: admin.accessJwt, raw: bytes, contentType: value.mimeType });
      if (up.blob.ref.$link !== cid) throw new Error(`blob の CID が変わった ${cid} → ${up.blob.ref.$link}`);
      cache.set(cid, up.blob);
    }
    return cache.get(cid);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await reuploadBlobs(v, devPds, admin, cache);
  return out;
}

/** プレイヤーの気質診断。ローカルには AppView (投稿の取得) が無く診断を回せないので、固定値を置く。
 *  これは「スキップ」扱い (playthrough.md に記録する)。 */
async function ensureAnalysis(player) {
  const collection = `${ADMIN_PREFIX}.analysis`;
  const existing = await xrpc(PDS_URL, 'com.atproto.repo.getRecord', { params: { repo: player.did, collection, rkey: 'self' } }).catch(() => null);
  if (existing) return;
  const now = new Date().toISOString();
  await xrpc(PDS_URL, 'com.atproto.repo.putRecord', {
    token: player.accessJwt,
    body: {
      repo: player.did, collection, rkey: 'self', validate: false,
      record: {
        $type: collection, archetype: 'warrior',
        rpgStats: { atk: 30, def: 22, agi: 20, int: 12, luk: 16 },
        cognitiveScores: { Ni: 20, Ne: 30, Si: 40, Se: 90, Ti: 60, Te: 70, Fi: 30, Fe: 20 },
        confidence: 'medium', analyzedPostCount: 50, analyzedAt: now,
        jobLevel: { archetype: 'warrior', xp: 0, joinedAt: now }, playerLevel: { xp: 0, streakDays: 0 }, public: false,
      },
    },
  });
  console.log(`診断 (固定値 warrior) を置いた: ${player.handle}`);
}

/** edge (wrangler dev) の変数。秘密鍵はここで作ったローカル専用の鍵 (dev / 本番の secret は読まない)。 */
function writeEdgeVars(admin, server) {
  // wrangler dev は設定ファイルの隣の .dev.vars を読む (gitignore 済)。
  const varsFile = path.join(HERE, '.dev.vars');
  const keysFile = path.join(STATE_DIR, 'edge-keys.json');
  const keys = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, 'utf8')) : { client: generateP256Jwk(), dpop: generateP256Jwk(), worldToken: crypto.randomBytes(32).toString('hex') };
  fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
  const vars = {
    WORKER_DID: EDGE_DID,
    PUBLIC_ORIGIN: EDGE_URL,
    ALLOWED_ORIGINS: WEB_URL,
    SERVER_DID: server.did,
    SERVER_PDS_URL: PDS_URL,
    ADMIN_DIDS: admin.did,
    ADMIN_NSID_ENV: 'dev',
    PLC_DIRECTORY_URL: PLC_URL,
    ALLOW_LOOPBACK_HTTP: '1',
    OAUTH_LOOPBACK_CLIENT: '1',
    OAUTH_CLIENT_PRIVATE_JWK: JSON.stringify(keys.client),
    OAUTH_DPOP_PRIVATE_JWK: JSON.stringify(keys.dpop),
    WORLD_TOKEN_SECRET: keys.worldToken,
  };
  // .dev.vars は dotenv 形式。値は単一引用符で囲む (JSON の " をそのまま渡す)。
  fs.writeFileSync(varsFile, Object.entries(vars).map(([k, v]) => `${k}='${v}'`).join('\n') + '\n', { mode: 0o600 });
}

/** web (vite dev) の env。ローカルの edge / PLC / PDS だけを指す。 */
function writeWebEnv(admin) {
  const env = {
    VITE_APP_URL: WEB_URL,
    VITE_NSID_ROOT: 'app.aozoraquest',
    VITE_NSID_ENV: 'local',
    VITE_EDGE_URL: EDGE_URL,
    VITE_EDGE_DID: EDGE_DID,
    VITE_ADMIN_DIDS: admin.did,
    VITE_PLC_DIRECTORY_URL: PLC_URL,
    VITE_PUBLIC_APPVIEW_URL: PDS_URL,
    VITE_HANDLE_RESOLVER_URL: PDS_URL,
    VITE_ATPROTO_ALLOW_HTTP: '1',
  };
  fs.writeFileSync(path.join(STATE_DIR, 'web.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}

export async function seed({ freshPlayer = false } = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const saved = loadAccounts();
  if (freshPlayer) {
    for (const key of ['player', 'player2']) {
      if (saved[key]) await adminDelete(saved[key].did).catch((e) => console.warn(`旧 ${key} の削除に失敗 (無視)`, e.message));
      delete saved[key];
    }
    saveAccounts(saved);
  }
  const admin = await ensureAccount(saved, 'admin');
  const server = await ensureAccount(saved, 'server');
  const player = await ensureAccount(saved, 'player');
  const player2 = await ensureAccount(saved, 'player2');
  await copyWorld(admin);
  await ensureAnalysis(player);
  await ensureAnalysis(player2);
  writeEdgeVars(admin, server);
  writeWebEnv(admin);
  return { admin, server, player, player2 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ freshPlayer: process.argv.includes('--fresh-player') }).catch((e) => { console.error(e.message); process.exit(1); });
}
