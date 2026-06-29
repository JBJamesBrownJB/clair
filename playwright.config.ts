import { defineConfig } from '@playwright/test';

// End-to-end smoke. Boots the API + the built client preview, then drives the
// real browser. Deliberately thin — the bulk of behaviour is covered by the
// Vitest integration suite.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: [
    {
      command: 'pnpm db:reset && pnpm start',
      port: 3001,
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: 'pnpm build:client && vite preview --port 4173',
      port: 4173,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
