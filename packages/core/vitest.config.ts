import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    setupFiles: ['./src/__tests__/helpers/monster-setup.ts'],
  },
});
