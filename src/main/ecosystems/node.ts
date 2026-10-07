import { z } from 'zod';
import type { EcosystemModule } from './types';

/**
 * Node.js project info: which package manager runs this package.
 */
const NodeInfoSchema = z.object({
  /** Package manager detected from the lockfile. */
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

/**
 * Node.js ecosystem module: detects Node.js projects via package.json and offers the
 * package manager's own commands.
 *
 * package.json scripts are already rows of their own (kind 'npm'), so this module never
 * mirrors them: a detected task with a script's name would lose the name-uniqueness check
 * and never show. It adds only what no script provides.
 */
export const nodeModule: EcosystemModule<NodeInfo> = {
  id: 'node',
  infoSchema: NodeInfoSchema,

  /**
   * Detect Node.js projects by looking for package.json, and pick the package manager
   * from the lockfile. Pure: the lockfile's name is enough, its contents are never read.
   */
  async detect(_dir: string, files: ReadonlySet<string>, _dirs: ReadonlySet<string>) {
    if (!files.has('package.json')) return null;

    // Priority order: a repo with several lockfiles runs on the one its tooling prefers.
    let packageManager: NodeInfo['packageManager'] = 'npm';
    if (files.has('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (files.has('bun.lockb')) packageManager = 'bun';
    else if (files.has('yarn.lock')) packageManager = 'yarn';
    else if (files.has('package-lock.json')) packageManager = 'npm';

    return { packageManager };
  },

  /**
   * Globs that identify a Node.js package in a monorepo: any folder with a package.json.
   */
  packageGlobs: ['**/package.json'],

  /**
   * The package manager's own commands. Only names no package.json script can take:
   * `install` and `ci` are package-manager verbs, not scripts a project defines.
   */
  tasks(info: NodeInfo) {
    const pm = info.packageManager;
    return [
      { name: 'install', argv: [pm, 'install'], title: 'Install dependencies' },
      {
        name: 'ci',
        argv: pm === 'npm' ? ['npm', 'ci'] : [pm, 'install', '--frozen-lockfile'],
        title: 'Clean install from the lockfile',
      },
    ];
  },

  /**
   * No special environment: the package manager is expected on PATH.
   */
  async runEnv(_ctx, _info: NodeInfo) {
    return {};
  },

  summary(info: NodeInfo): string | null {
    return `Node.js · ${info.packageManager}`;
  },
};