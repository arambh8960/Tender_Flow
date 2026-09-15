import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * E2E runs against a REAL Supabase project, because the flows under test are
 * exactly the ones that depend on auth, RLS and storage. Without credentials
 * the specs skip themselves rather than failing, so `npm test` stays useful
 * on a machine that has none — see tests/e2e/README.md for what to set.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Tenant-isolation specs sign in as two different companies; running them
  // in parallel against one browser profile would cross the sessions.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Serves the production build, so E2E exercises what actually ships.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
