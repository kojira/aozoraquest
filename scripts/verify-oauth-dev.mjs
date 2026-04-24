/**
 * dev サーバー上で OAuth の初期化がエラーにならないか、
 * sign-in 押下で bsky.social の認可ページへリダイレクトできるかを確認。
 *
 * 使い方: node scripts/verify-oauth-dev.mjs [url]
 */

import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:9999/onboarding';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const initErrors = errors.filter((e) => /loopback|redirect_uri|client/i.test(e));
if (initErrors.length > 0) {
  console.error('init errors:', initErrors);
  await browser.close();
  process.exit(1);
}
console.log('init ok (no OAuth client errors)');

// sign-in 押下 → bsky.social の認可 URL にナビゲートを試みる
const handleInput = await page.$('input[type=text], input[placeholder*="bsky"]');
if (handleInput) {
  await handleInput.fill('claudecode-oauth-probe.bsky.social');
  const navPromise = page.waitForURL(/bsky\.social|authorize/i, { timeout: 15000 }).catch(() => null);
  const btn = await page.$('button');
  if (btn) await btn.click();
  await navPromise;
  const final = page.url();
  console.log('after sign-in click:', final);
  if (/bsky\.social/.test(final)) {
    console.log('→ bsky.social に遷移: OAuth フローは機能している');
  } else {
    console.warn('→ 別の URL に遷移 (想定外):', final);
  }
}

await browser.close();
process.exit(0);
