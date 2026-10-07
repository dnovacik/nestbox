import { z } from 'zod';
import type { EcosystemModule } from './types';

/**
 * Node.js project info: package manager and whether it has scripts.
 */
const NodeInfoSchema = z.object({
  /** Package manager detected (npm, pnpm, yarn, bun) */
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
  /** Whether package.json has a "start" script */
  hasStartScript: z.boolean(),
  /** Whether package.json has a "dev" script */
  hasDevScript: z.boolean(),
  /** Whether package.json has a "test" script */
  hasTestScript: z.boolean(),
  /** Whether package.json has a "build" script */
  hasBuildScript: z.boolean(),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

/**
 * Node.js ecosystem module: detects Node.js projects via package.json
 * and provides standard npm/pnpm/yarn/bun commands (install, run, test, build).
 */
export const nodeModule: EcosystemModule<NodeInfo> = {
  id: 'node',
  infoSchema: NodeInfoSchema,

  /**
   * Detect Node.js projects by looking for package.json.
   * Determines package manager from lockfiles.
   */
  async detect(dir: string, files: ReadonlySet<string>, _dirs: ReadonlySet<string>) {
    if (!files.has('package.json')) return null;

    // Detect package manager from lockfiles (priority order)
    let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';
    if (files.has('pnpm-lock.yaml')) {
      packageManager = 'pnpm';
    } else if (files.has('bun.lockb')) {
      packageManager = 'bun';
    } else if (files.has('yarn.lock')) {
      packageManager = 'yarn';
    } else if (files.has('package-lock.json')) {
      packageManager = 'npm';
    }

    // Read package.json to detect scripts
    let hasStartScript = false;
    let hasDevScript = false;
    let hasTestScript = false;
    let hasBuildScript = false;

    try {
      const { readFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const content = await readFile(join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(content);

      if (pkg && typeof pkg === 'object' && pkg.scripts && typeof pkg.scripts === 'object') {
        hasStartScript = 'start' in pkg.scripts;
        hasDevScript = 'dev' in pkg.scripts;
        hasTestScript = 'test' in pkg.scripts;
        hasBuildScript = 'build' in pkg.scripts;
      }
    } catch {
      // If we can't read package.json, still detect as Node project but without scripts
    }

    return {
      packageManager,
      hasStartScript,
      hasDevScript,
      hasTestScript,
      hasBuildScript,
    };
  },

  /**
   * Globs that identify a Node.js package in a monorepo.
   * Any folder with package.json is a Node package.
   */
  packageGlobs: ['**/package.json'],

  /**
   * Provide detected tasks based on available scripts and package manager.
   * Common tasks: install, dev/start, test, build.
   */
  tasks(info: NodeInfo) {
    const pm = info.packageManager;
    const tasks = [];

    // Install dependencies
    tasks.push({
      name: 'install',
      argv: [pm, 'install'],
      title: 'Install dependencies',
    });

    // Dev or start (prefer dev, fallback to start)
    if (info.hasDevScript) {
      tasks.push({
        name: 'dev',
        argv: [pm, 'run', 'dev'],
        title: 'Dev',
      });
    } else if (info.hasStartScript) {
      tasks.push({
        name: 'start',
        argv: [pm, 'run', 'start'],
        title: 'Start',
      });
    }

    // Build
    if (info.hasBuildScript) {
      tasks.push({
        name: 'build',
        argv: [pm, 'run', 'build'],
        title: 'Build',
      });
    }

    // Test
    if (info.hasTestScript) {
      tasks.push({
        name: 'test',
        argv: [pm, 'run', 'test'],
        title: 'Test',
      });
    }

    return tasks;
  },

  /**
   * Provide run environment for Node.js tasks.
   * No special environment needed - package manager is expected to be in PATH.
   */
  async runEnv(_ctx, _info: NodeInfo) {
    return {};
  },

  /**
   * One-line summary for project-info display.
   */
  summary(info: NodeInfo): string | null {
    return `Node.js · ${info.packageManager}`;
  },
};
