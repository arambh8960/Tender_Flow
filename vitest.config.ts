import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests run in Node: everything under test is server
 * logic (agents, scoring, security guards) or pure helpers.
 *
 * The RLS and tenant-isolation suites are NOT run here — they need a live
 * Supabase project and are driven by `npm run test:rls` against real
 * credentials, so a developer without them still gets a green unit run.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    // Component tests need a DOM; everything else is server logic and runs
    // faster without one, so the environment is opted into per file via the
    // `@vitest-environment jsdom` docblock.
    environmentMatchGlobs: [['tests/unit/**/*.test.tsx', 'jsdom']],
    exclude: ['node_modules/**', 'tests/e2e/**', 'tests/rls/**', 'tests/api/**'],
    globals: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['server/**/*.ts'],
      exclude: ['server/**/*.d.ts', 'server/listModels.ts'],
    },
  },
});
