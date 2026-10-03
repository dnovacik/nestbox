import { defineConfig } from '@playwright/test';

// Runs the built app (pnpm build first) through Playwright's Electron support, on Windows and macOS (CI runs
// both). On Linux the app runs with the macOS adapter, so most specs work there too (under xvfb-run).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results',
  use: { trace: 'retain-on-failure' },
});
