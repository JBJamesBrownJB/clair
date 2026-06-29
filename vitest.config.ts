import { defineConfig } from 'vitest/config';

// Visible test suite. Coverage is good-but-incomplete by design: breakage is
// detectable, but regressions can still ship — the realistic condition the
// benchmark wants.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
