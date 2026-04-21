/**
 * 非認証レンダリングのスモークテスト。
 *
 * - web / admin の vite preview サーバーを起動
 * - chromium で / を訪問
 * - 主要文言が見えることを確認
 * - コンソールエラー 0 件を確認 (preview 特有の loopback URL エラーは許容)
 */

/** preview モード特有の無害エラー。本番や dev では起きない。 */
const IGNORABLE_ERROR_PATTERNS = [
  /Invalid loopback client ID/i, // preview が 127.0.0.1 で OAuth 初期化するとき。dev/prod では起きない
];

function isIgnorable(msg: string): boolean {
  return IGNORABLE_ERROR_PATTERNS.some((re) => re.test(msg));
}

import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';

interface Preview {
  proc: ChildProcess;
  url: string;
  label: string;
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function launchPreview(pkgFilter: string, port: number, label: string): Preview {
  const proc = spawn('pnpm', ['--filter', pkgFilter, 'preview', '--host', '127.0.0.1', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1' },
  });
  proc.stdout?.on('data', (b: Buffer) => process.stdout.write(`[${label}] ${b.toString()}`));
  proc.stderr?.on('data', (b: Buffer) => process.stderr.write(`[${label}!] ${b.toString()}`));
  return { proc, url: `http://127.0.0.1:${port}`, label };
}

async function kill(p: Preview): Promise<void> {
  if (!p.proc.pid) return;
  try {
    process.kill(-p.proc.pid);
  } catch {
    try {
      p.proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const web = launchPreview('@aozoraquest/web', 4173, 'web');
  const admin = launchPreview('@aozoraquest/admin', 4174, 'admin');

  try {
    await Promise.all([waitFor(web.url), waitFor(admin.url)]);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const failures: string[] = [];

    try {
      // ─── web ───
      const webPage = await context.newPage();
      const webErrors: string[] = [];
      webPage.on('pageerror', (e) => webErrors.push(String(e)));
      webPage.on('console', (msg) => {
        if (msg.type() === 'error') webErrors.push(msg.text());
      });
      await webPage.goto(web.url, { waitUntil: 'domcontentloaded' });
      // セッション復元中 → サインアウト状態に落ちるまで少し待つ
      await webPage.waitForSelector('text=ログインして始める', { timeout: 15_000 });
      console.log('[web] unauthenticated home rendered');

      // footer nav には「精霊」リンクがあるはず
      const spiritLink = await webPage.getByRole('link', { name: '精霊' }).count();
      if (spiritLink < 1) failures.push('[web] footer nav に「精霊」リンクが無い');

      const webRealErrors = webErrors.filter((e) => !isIgnorable(e));
      if (webRealErrors.length > 0) {
        console.warn('[web] console/page errors:', webRealErrors);
        failures.push(`[web] ${webRealErrors.length} errors: ${webRealErrors.slice(0, 3).join(' | ')}`);
      }

      // ─── admin ───
      const adminPage = await context.newPage();
      const adminErrors: string[] = [];
      adminPage.on('pageerror', (e) => adminErrors.push(String(e)));
      adminPage.on('console', (msg) => {
        if (msg.type() === 'error') adminErrors.push(msg.text());
      });
      await adminPage.goto(admin.url, { waitUntil: 'domcontentloaded' });
      // admin は DID 未設定だと「設定エラー」か、認証ゲート「管理者ログイン」が見えるはず
      await adminPage.waitForFunction(
        () => /管理者ログイン|設定エラー/.test(document.body.innerText),
        { timeout: 15_000 },
      );
      console.log('[admin] gated screen rendered');

      const adminRealErrors = adminErrors.filter((e) => !isIgnorable(e));
      if (adminRealErrors.length > 0) {
        console.warn('[admin] console/page errors:', adminRealErrors);
        failures.push(`[admin] ${adminRealErrors.length} errors: ${adminRealErrors.slice(0, 3).join(' | ')}`);
      }
    } finally {
      await browser.close();
    }

    if (failures.length > 0) {
      console.error('\nSMOKE FAILURES:');
      for (const f of failures) console.error('  ✗', f);
      process.exitCode = 1;
    } else {
      console.log('\nsmoke ok ✓');
    }
  } finally {
    await kill(web);
    await kill(admin);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
