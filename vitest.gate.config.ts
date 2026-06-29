import { defineConfig } from 'vitest/config';

// HELD-OUT acceptance gate. This is NOT the visible suite (`pnpm test` →
// vitest.config.ts → tests/). The harness runs this after integrating the
// slices; the slice agents never see `gate/`.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['gate/**/*.test.ts'],
    setupFiles: ['gate/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
