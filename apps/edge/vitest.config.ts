import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['../../packages/core/src/__tests__/helpers/monster-setup.ts'],
  },
});
