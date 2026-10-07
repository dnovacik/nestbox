import { z } from 'zod';
import type { EcosystemModule, DetectedTask, RunEnv, RunEnvContext } from './types';

/**
 * Test-only ecosystem module for unit tests.
 * NOT registered in ECOSYSTEM_MODULES — only used in test files.
 */

const TestInfoSchema = z.object({
  version: z.string(),
  marker: z.string(),
});

type TestInfo = z.infer<typeof TestInfoSchema>;

export const TEST_ECOSYSTEM_MODULE: EcosystemModule<TestInfo> = {
  id: 'python', // Use 'python' as a valid EcosystemId for tests
  infoSchema: TestInfoSchema,

  async detect(dir: string, files: ReadonlySet<string>, dirs: ReadonlySet<string>): Promise<TestInfo | null> {
    // Detect when test-marker.txt exists
    if (files.has('test-marker.txt')) {
      return {
        version: '1.0.0',
        marker: 'test-marker.txt',
      };
    }
    return null;
  },

  packageGlobs: ['test-pkg-*/*.test'],

  tasks(info: TestInfo): DetectedTask[] {
    return [
      {
        name: 'test-run',
        argv: ['test-cmd', 'run'],
        title: 'Run tests',
      },
      {
        name: 'test-check',
        argv: ['test-cmd', 'check'],
        title: 'Check tests',
      },
    ];
  },

  async runEnv(ctx: RunEnvContext, info: TestInfo): Promise<RunEnv> {
    return {
      pathPrepend: '/test/bin',
      env: {
        TEST_VERSION: info.version,
        TEST_MODE: 'test',
      },
      note: `Using test module ${info.version}`,
    };
  },

  summary(info: TestInfo): string {
    return `Test ${info.version}`;
  },
};
