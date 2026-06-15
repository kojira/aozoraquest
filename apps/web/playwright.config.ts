import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 2 アカウント quest E2E 用の資格情報を gitignore 済み .env.e2e.local から読み込む
// (dotenv 依存を増やさず手動パース)。無ければ何もしない → spec 側で test.skip。
try {
  const raw = readFileSync(resolve(__dirname, '.env.e2e.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* creds 無し: quest E2E は skip される */
}

export default defineConfig({
  testDir: './e2e',
  timeout: 10 * 60 * 1000, // モデル初回 DL が重いので長め
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
