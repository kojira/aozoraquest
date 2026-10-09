import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts', '../../packages/core/src/__tests__/helpers/monster-setup.ts'],
    // .tsx も拾う (コンポーネントの回帰テスト。DOM が要る file は先頭の
    // `// @vitest-environment jsdom` で個別に切り替える — 既定は node のまま)
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
