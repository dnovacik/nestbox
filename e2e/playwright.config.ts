import { defineConfig } from '@playwright/test';

// Runs the built app (pnpm build first) through Playwright's Electron support. Windows only for now:
// spawning scripts is stubbed on macOS until the v2 macOS phase.
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
