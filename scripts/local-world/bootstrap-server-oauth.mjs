// ローカル edge の「サーバーアカウント OAuth 連携」を自動で済ませる。D-LOCAL-PLAY-001 / #1018。
// 本番 / dev では管理者が設定画面のボタンから行う手順 (docs/22 §4) と同じ流れを、ローカル PDS の
// サインイン画面を Playwright で操作して行う。相手はすべてローカル (PDS = localhost:2583、edge = 127.0.0.1:8788)。
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { EDGE_DID, EDGE_URL, PDS_URL, STATE_DIR } from './ports.mjs';

const LXM_OAUTH_START = 'app.aozoraquest.oauth.start';

async function serviceAuth(account, lxm) {
  const s = await (await fetch(`${PDS_URL}/xrpc/com.atproto.server.createSession`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: account.did, password: account.password }) })).json();
  const r = await (await fetch(`${PDS_URL}/xrpc/com.atproto.server.getServiceAuth?${new URLSearchParams({ aud: EDGE_DID, lxm })}`, { headers: { authorization: `Bearer ${s.accessJwt}` } })).json();
  if (!r.token) throw new Error(`getServiceAuth に失敗: ${JSON.stringify(r)}`);
  return r.token;
}

export async function bootstrapServerOAuth() {
  const accounts = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'accounts.json'), 'utf8'));
  const token = await serviceAuth(accounts.admin, LXM_OAUTH_START);
  const start = await fetch(`${EDGE_URL}/api/oauth/start`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  const { authorizeUrl, error, message } = await start.json();
  if (!authorizeUrl) throw new Error(`oauth/start に失敗: ${error} ${message ?? ''}`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(authorizeUrl);
    await page.locator('input[name="password"]').fill(accounts.server.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // 同意画面 (初回だけ出る)。出なければそのまま edge の callback に戻る。
    const accept = page.getByRole('button', { name: /Accept|Authorize|Allow/ });
    await Promise.race([
      accept.waitFor({ timeout: 15_000 }).then(() => accept.click()),
      page.waitForURL(`${EDGE_URL}/oauth/callback**`, { timeout: 15_000 }),
    ]);
    await page.waitForURL(`${EDGE_URL}/oauth/callback**`, { timeout: 15_000 });
    const body = await page.locator('body').innerText();
    if (!body.includes('連携できました')) throw new Error(`連携に失敗: ${body.slice(0, 200)}`);
    console.log('サーバーアカウント OAuth 連携: OK');
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bootstrapServerOAuth().catch((e) => { console.error(e.message); process.exit(1); });
}
