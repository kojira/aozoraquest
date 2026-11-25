// ローカルだけで動くあおぞらワールドを 1 コマンドで起動する。D-LOCAL-PLAY-001 / #1018。
//
//   pnpm local:world               … 起動 (初回はアカウント作成と dev の world.* の写しも行う)
//   pnpm local:world fresh-player  … プレイヤー 2 人を作り直して起動 (最初から遊べる)
//   pnpm local:world reset         … ローカルの状態 (.state/) を全部消す (次の起動で作り直す)
//
// 起動するもの: PLC + PDS (network.mjs) → 種まき (seed.mjs) → edge (wrangler dev) → サーバーアカウント
// OAuth 連携 (初回のみ) → web (vite dev)。つなぎ先はすべてローカル。dev / 本番の PDS・edge・secret は使わない。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNTS, EDGE_PORT, EDGE_URL, HERE, PDS_URL, REPO_ROOT, STATE_DIR, WEB_PORT, WEB_URL } from './ports.mjs';

const children = [];
function run(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const out = fs.createWriteStream(path.join(STATE_DIR, `${name}.log`), { flags: 'a' });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('exit', (code) => console.log(`[local-world] ${name} が終了 (${code})`));
  children.push(child);
  return child;
}

async function waitFor(url, label, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} が起動しない (${url})。ログ: ${STATE_DIR}`);
}

function readEnvFile(file) {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

async function serverOAuthLinked() {
  // KV は wrangler dev のローカル永続 (.state/wrangler)。連携済みかは edge のトークン有無で見る代わりに印ファイルで持つ。
  return fs.existsSync(path.join(STATE_DIR, 'server-oauth.linked'));
}

async function main() {
  const cmd = process.argv[2] ?? 'start';
  if (cmd === 'reset') {
    fs.rmSync(STATE_DIR, { recursive: true, force: true });
    fs.rmSync(path.join(HERE, '.dev.vars'), { force: true });
    console.log('[local-world] .state/ を消した。次の `pnpm local:world` で最初から作る。');
    return;
  }
  fs.mkdirSync(STATE_DIR, { recursive: true });

  console.log('[local-world] PLC + PDS を起動…');
  run('network', process.execPath, [path.join(HERE, 'network.mjs')], { cwd: HERE });
  await waitFor(`${PDS_URL}/xrpc/_health`, 'PDS');

  console.log('[local-world] アカウントとワールドを用意…');
  const { seed } = await import('./seed.mjs');
  await seed({ freshPlayer: cmd === 'fresh-player' });

  console.log('[local-world] edge (wrangler dev) を起動…');
  const edgeDir = path.join(REPO_ROOT, 'apps', 'edge');
  run('edge', path.join(edgeDir, 'node_modules', '.bin', 'wrangler'), [
    'dev', '-c', path.join(HERE, 'edge.wrangler.toml'), '--ip', '127.0.0.1', '--port', String(EDGE_PORT),
    '--persist-to', path.join(STATE_DIR, 'wrangler'), '--test-scheduled', '--show-interactive-dev-session=false',
  ], { cwd: edgeDir });
  await waitFor(`${EDGE_URL}/client-metadata.json`, 'edge');

  if (!(await serverOAuthLinked())) {
    console.log('[local-world] サーバーアカウントの OAuth 連携 (初回のみ)…');
    const { bootstrapServerOAuth } = await import('./bootstrap-server-oauth.mjs');
    await bootstrapServerOAuth();
    fs.writeFileSync(path.join(STATE_DIR, 'server-oauth.linked'), new Date().toISOString());
  }
  // wrangler dev は cron を自動では回さないので、本番と同じ 10 分ごとに scheduled を叩く (トークンの refresh)。
  const tick = () => fetch(`${EDGE_URL}/__scheduled?cron=*/10+*+*+*+*`).catch(() => {});
  void tick();
  setInterval(tick, 10 * 60 * 1000);

  console.log('[local-world] web (vite dev) を起動…');
  const webDir = path.join(REPO_ROOT, 'apps', 'web');
  run('web', path.join(webDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort', '--mode', 'localworld'], {
    cwd: webDir,
    env: { ...process.env, ...readEnvFile(path.join(STATE_DIR, 'web.env')) },
  });
  await waitFor(WEB_URL, 'web');

  const accounts = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'accounts.json'), 'utf8'));
  console.log(`
[local-world] 準備できました。ブラウザで ${WEB_URL}/world を開く (localhost ではなく 127.0.0.1)。
  ログイン: ハンドル ${ACCOUNTS.player.handle} → ローカル PDS のサインイン画面でパスワード
  パスワードは ${path.join(STATE_DIR, 'accounts.json')} (player / player2。ローカル専用)
  プレイヤー: ${accounts.player.did}
  ログ: ${STATE_DIR}/{network,edge,web}.log
  止める: Ctrl+C
`);
}

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

main().catch((e) => {
  console.error(`[local-world] 失敗: ${e.message}`);
  stop();
});
