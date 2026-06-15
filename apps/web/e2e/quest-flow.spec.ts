import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { AtpAgent } from '@atproto/api';

/**
 * 依頼クエストの **発行→応募→受託→受託者の「受託中」カラム→完了報告→承認待ち→承認→
 * 双方完了→報酬** を、2 アカウントの実 UI (OAuth ログイン) で end-to-end 検証する。
 *
 * これが緑になることが「クエストフロー完全解消」の定義。オーナーの手作業確認に依存しない。
 *
 * 前提:
 *  - `apps/web/.env.e2e.local` に 2 つの **捨てて良いテスト専用アカウント** の handle +
 *    app-password を入れる (テンプレ .env.e2e.example)。無ければ test.skip。
 *  - 実行: `pnpm --filter @aozoraquest/web test:quest-e2e`
 *  - 実 PDS (bsky.social) にレコードを作るので、afterAll で両アカウントの quest 関連
 *    レコードを全削除してクリーンアップする。
 *  - 127.0.0.1 preview + loopback OAuth client で実 bsky.social に対し OAuth する。
 */

const SERVICE = process.env.QUEST_E2E_SERVICE || 'https://bsky.social';
const A = { handle: process.env.QUEST_E2E_A_HANDLE || '', password: process.env.QUEST_E2E_A_PASSWORD || '' };
const B = { handle: process.env.QUEST_E2E_B_HANDLE || '', password: process.env.QUEST_E2E_B_PASSWORD || '' };
const HAS_CREDS = !!(A.handle && A.password && B.handle && B.password);

// アプリの書き込み先 collection は env で分離される (collections.ts: USER_PREFIX = ROOT[.ENV])。
// preview は .env.development の VITE_NSID_ROOT=app.aozoraquest / VITE_NSID_ENV=local を使うので
// 既定をそれに合わせる。**安全装置**: ENV が空 (= production NSID) のとき cleanup は実行しない
// (万一 prod を触った creds を入れても本番クエストを消さない)。
const NSID_ROOT = process.env.QUEST_E2E_NSID_ROOT || 'app.aozoraquest';
const NSID_ENV = (process.env.QUEST_E2E_NSID_ENV ?? 'local').trim();
const PREFIX = NSID_ENV ? `${NSID_ROOT}.${NSID_ENV}` : NSID_ROOT;
const QUEST_COLLECTIONS = ['userQuest', 'questApplication', 'questCompletion'].map(c => `${PREFIX}.${c}`);

// 一意なクエストタイトル (並行/再実行で衝突しないよう実行時刻を入れる)。
const STAMP = `${Date.now()}`;
const QUEST_TITLE = `E2Eテスト依頼 ${STAMP}`;

/** onboarding から OAuth ログインして board に到達する。
 *  bsky.social の認可画面 UI に依存するため、selector は実行して調整する想定。 */
async function login(page: Page, handle: string, password: string): Promise<void> {
  await page.goto('/onboarding');
  // handle 入力 → サインイン (BrowserOAuthClient が bsky.social へ redirect)
  await page.getByPlaceholder('yourname.bsky.social').fill(handle);
  await page.getByRole('button', { name: /始める|サインイン|ログイン/ }).click();

  // ── bsky.social の OAuth 画面 (別オリジン) ──
  await page.waitForURL(/bsky\.social|\.host\.bsky\.network/, { timeout: 60_000 });
  // サインイン: identifier + password
  const identifier = page.getByLabel(/handle|username|ユーザー|identifier/i).or(page.locator('input[type="text"]').first());
  if (await identifier.count()) await identifier.first().fill(handle);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: /sign in|next|続ける|ログイン/i }).first().click();
  // 認可 (consent) ボタン
  const authorize = page.getByRole('button', { name: /authorize|accept|許可|承認|allow/i });
  await authorize.first().click({ timeout: 60_000 }).catch(() => { /* 自動承認や省略時 */ });

  // ── アプリへ戻る (oauth/callback → セッション確立) ──
  await page.waitForURL(/127\.0\.0\.1:4173/, { timeout: 60_000 });
  await page.goto('/board');
  await expect(page.getByText('募集中').first()).toBeVisible({ timeout: 30_000 });
}

async function cleanupAccount(handle: string, password: string): Promise<void> {
  // 安全装置: env 無し (= production NSID) では絶対に削除しない。
  if (!NSID_ENV) {
    console.warn('[quest-e2e] NSID_ENV が空 (production) のため cleanup を中止 (本番クエスト保護)');
    return;
  }
  try {
    const agent = new AtpAgent({ service: SERVICE });
    await agent.login({ identifier: handle, password });
    const did = agent.assertDid;
    let count = 0;
    for (const col of QUEST_COLLECTIONS) {
      // ページングして全件消す (再実行でゴミが 100 件を超えても確実に掃除)
      let cursor: string | undefined;
      do {
        const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: col, limit: 100, cursor });
        for (const r of res.data.records) {
          const rkey = r.uri.split('/').pop()!;
          await agent.com.atproto.repo.deleteRecord({ repo: did, collection: col, rkey }).catch(() => {});
          count += 1;
        }
        cursor = res.data.cursor;
      } while (cursor);
    }
    console.info(`[quest-e2e] cleanup ${handle}: deleted ${count} records under ${PREFIX}.*`);
  } catch (e) {
    console.warn('[quest-e2e] cleanup failed', handle, e);
  }
}

test.describe('依頼クエスト 2 アカウント フル E2E', () => {
  test.skip(!HAS_CREDS, 'apps/web/.env.e2e.local に QUEST_E2E_{A,B}_HANDLE/PASSWORD が必要');
  test.setTimeout(8 * 60 * 1000);

  let ctxA: BrowserContext;
  let ctxB: BrowserContext;
  let pageA: Page;
  let pageB: Page;
  let questUrl = '';

  test.beforeAll(async ({ browser }) => {
    ctxA = await browser.newContext();
    ctxB = await browser.newContext();
    pageA = await ctxA.newPage();
    pageB = await ctxB.newPage();
    await login(pageA, A.handle, A.password);
    await login(pageB, B.handle, B.password);
  });

  test.afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
    await cleanupAccount(A.handle, A.password);
    await cleanupAccount(B.handle, B.password);
  });

  test('発行→応募→受託→受託中→報告→承認→双方完了', async () => {
    // 1) A がクエスト発行 (board-new の Field は htmlFor 非関連なので placeholder / type で指定)
    await pageA.goto('/board/new');
    await pageA.getByPlaceholder('例: 精霊のイラストを描いてくれる人募集').fill(QUEST_TITLE);
    await pageA.getByPlaceholder('やってほしいことの詳細、納期、参考リンクなど').fill('E2E 自動テストの依頼です。');
    await pageA.locator('input[type="number"]').first().fill('100');
    await pageA.getByRole('button', { name: 'クエストを出す' }).click();
    // 発行後は詳細 (/board/:repo/:rkey) に遷移
    await pageA.waitForURL(/\/board\/did:[^/]+\/[^/]+$/, { timeout: 30_000 });
    questUrl = pageA.url();
    await expect(pageA.getByText(QUEST_TITLE)).toBeVisible();

    // 2) B が募集中で発見し応募 (直リンクでも可)
    await pageB.goto(questUrl);
    await expect(pageB.getByText(QUEST_TITLE)).toBeVisible({ timeout: 30_000 });
    await pageB.getByRole('button', { name: /このクエストに応募する|応募する/ }).first().click();
    await pageB.getByLabel(/応募メッセージ|メッセージ/).fill('やります! (E2E)');
    await pageB.getByRole('button', { name: '応募する' }).click();
    await expect(pageB.getByText(/あなたの応募|応募/)).toBeVisible({ timeout: 30_000 });

    // 3) A が応募を確認 → B を受託者に指定
    await pageA.goto(questUrl);
    await expect(pageA.getByText(/応募者/)).toBeVisible({ timeout: 30_000 });
    await pageA.getByRole('button', { name: '受託者に指定' }).first().click();
    await pageA.getByRole('button', { name: '確定する' }).click();
    await expect(pageA.getByText('受託中')).toBeVisible({ timeout: 30_000 });

    // 4) B の「受託中」カラムにクエストが出る (= 消えるバグの回帰)
    await pageB.goto('/board');
    await expect(pageB.getByText('受託中').first()).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText(QUEST_TITLE)).toBeVisible({ timeout: 30_000 });

    // 5) B が完了報告
    await pageB.goto(questUrl);
    await pageB.getByRole('button', { name: '完了を報告する' }).first().click();
    await pageB.getByRole('button', { name: '完了を報告する' }).last().click();
    await expect(pageB.getByText(/承認待ち/)).toBeVisible({ timeout: 30_000 });

    // 6) A の掲示板に「承認待ち」バナー → 承認
    await pageA.goto('/board');
    await expect(pageA.getByText(/承認待ちが\s*\d+\s*件/)).toBeVisible({ timeout: 30_000 });
    await pageA.goto(questUrl);
    await pageA.getByRole('button', { name: /承認する/ }).first().click();
    await pageA.getByRole('button', { name: '承認する' }).last().click();

    // 7) 双方で「完了」表示
    await expect(pageA.getByText('完了').first()).toBeVisible({ timeout: 30_000 });
    await pageB.goto(questUrl);
    await expect(pageB.getByText('完了').first()).toBeVisible({ timeout: 30_000 });

    // 8) B の報酬 (ポイント / XP) が portfolio に反映
    await pageB.goto('/me/portfolio');
    await expect(pageB.getByText(/保有ポイント|クエストで得たステータス XP/)).toBeVisible({ timeout: 30_000 });
  });
});
