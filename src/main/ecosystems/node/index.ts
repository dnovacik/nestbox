// The Node.js ecosystem: folders with a package.json. Detection looks at file names only (detect.ts), the
// package manager comes from the lockfile (package-manager.ts), the root's npm/pnpm/yarn workspaces are its
// packages (workspaces.ts), the module adds the package manager's own commands (tasks.ts), checks
// dependencies through the package manager (deps.ts, deps-parse.ts), and gives every command the Node version
// advice: a warning when the versions don't match, fnm's Node first on PATH (version-check.ts).
import type { EcosystemModule, RunEnv } from '../types';
import { checkNode, nodeUpdateCommand } from './deps';
import { detectNode, lockfileManager, type NodeInfo, NodeInfoSchema } from './detect';
import { frameworkLabel } from './framework';
import { installState, installWarning } from './install-state';
import { lockfileWarning } from './package-manager';
import { nodeTasks } from './tasks';
import { nodeVersionCheck, type NodeVersionCheck } from './version-check';
import { nodeWorkspaces } from './workspaces';

export type { NodeInfo } from './detect';

/**
 * What runEnv needs from the app: whether the Node tool is on (checkVersions; off, a command gets no
 * advice) and the root project's fnm switch. Missing fields are off.
 */
export interface NodeRunSettings {
  checkVersions?: boolean;
  fnm?: boolean;
}

/**
 * Node.js ecosystem module: detects Node.js projects via package.json and offers the
 * package manager's own commands.
 *
 * package.json scripts are already rows of their own (kind 'npm'), so this module never
 * mirrors them: a detected task with a script's name would lose the name-uniqueness check
 * and never show. It adds only what no script provides.
 */
export function createNodeModule(
  deps: { check: NodeVersionCheck } = { check: nodeVersionCheck },
): EcosystemModule<NodeInfo, NodeRunSettings> {
  return {
    id: 'node',
    infoSchema: NodeInfoSchema,

    detect: detectNode,

    /**
     * A sub-folder with a package.json, one or two levels down (multi-folder projects).
     */
    packageGlobs: ['*/package.json', '*/*/package.json'],

    declaredWorkspaces: nodeWorkspaces,

    tasks: nodeTasks,

    deps: checkNode,

    depsUpdateCommand: nodeUpdateCommand,

    async installHint(ctx, info: NodeInfo) {
      const state = await installState(ctx.dir, ctx.rootDir, info);
      return state === 'missing' || state === 'stale' ? { state, task: 'install' } : null;
    },

    /** Health suggestions and the Inspector's default target, after PORT in .env. */
    ports: (info: NodeInfo) => info.ports,

    /** The Node version advice for any command of the package (npm scripts, install/ci, custom commands). */
    async runEnv(ctx, info: NodeInfo): Promise<RunEnv> {
      if (ctx.settings.checkVersions !== true) return {};
      const advice = await deps.check.advice({
        dir: ctx.dir,
        rootDir: ctx.rootDir ?? null,
        packageManager: lockfileManager(info),
        lockfiles: info.lockfiles,
        fnm: ctx.settings.fnm === true,
        platform: ctx.platform,
      });
      // Not on install/ci themselves: they're the fix.
      const install =
        ctx.task === 'install' || ctx.task === 'ci'
          ? null
          : installWarning(await installState(ctx.dir, ctx.rootDir ?? null, info));
      const warning = [advice.warning, install].filter((w) => w !== null).join('; ') || null;
      return {
        ...(warning === null ? {} : { warning }),
        ...(advice.pathPrepend === null ? {} : { pathPrepend: advice.pathPrepend }),
        ...(advice.note === null ? {} : { note: advice.note }),
      };
    },

    summary(info: NodeInfo): string | null {
      const parts = ['Node.js', info.packageManager];
      if (info.framework) parts.push(frameworkLabel(info.framework));
      if (lockfileWarning(info.lockfiles, info.packageManager) !== null)
        parts.push(`${info.lockfiles.length} lockfiles`);
      return parts.join(' · ');
    },
  };
}

export const nodeModule = createNodeModule();
