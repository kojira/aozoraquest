import { defineConfig } from 'vitest/config';
import path from 'node:path';

// 依頼クエストの 2 アカウント実 PDS 結合テスト専用 config。
// 通常の `pnpm test` (src/**) からは分離し、書き込み先 NSID を **隔離 env (e2etest)** に固定して
// 本番 (env 無し) を絶対に触らない。
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      VITE_NSID_ROOT: 'app.aozoraquest',
      VITE_NSID_ENV: 'e2etest',
      VITE_APP_URL: 'https://aozoraquest.app',
    },
  },
});
