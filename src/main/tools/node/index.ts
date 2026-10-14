// The Node tool: which Node version a package needs (version files, engines, Volta), whether the sources agree,
// and whether the Node and package manager that will run its scripts match. The check itself lives in the
// Node module (ecosystems/node/version-check.ts), whose runEnv gives every start the same advice; this tool
// shows it and owns the fnm switch.
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import {
  nodeContract,
  nodeDefinition,
  type NodeSettings,
  type StartAdvice,
} from '@shared/tools/node/contract';
import {
  createNodeVersionCheck,
  type NodeCheckInput,
  type NodeVersionCheck,
} from '../../ecosystems/node/version-check';
import { nodeOf } from '@shared/ecosystems/node';
import { lockfileManager } from '../../ecosystems/node/detect';
import { createVersionedFiles } from '../../fs/versioned-file';
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';

export interface NodeToolDeps {
  logger: Logger;
  clipboard: { writeText(text: string): void };
  /** Throws NOT_FOUND for unknown ids (the root project, for inherited sources). */
  getDetected(projectId: string): DetectedProject;
  /** The check, shared with the Node module in the app (its own one by default, for tests). */
  check?: NodeVersionCheck;
}

type Ctx = ToolContext<NodeSettings>;

/** The one file the Node tool writes. */
const versionFiles = createVersionedFiles({
  allowName: (name) => name === '.nvmrc',
  maxBytes: 1024,
  noun: 'version file',
});

export function createNodeTool(deps: NodeToolDeps): AnyMainTool {
  const check = deps.check ?? createNodeVersionCheck();

  function lockfileOf(project: DetectedProject): NodeCheckInput['packageManager'] {
    const info = nodeOf(project);
    return info ? lockfileManager(info) : null;
  }

  function rootDirOf(project: DetectedProject): string | null {
    if (project.relPath === '') return null;
    try {
      return deps.getDetected(project.rootId).path;
    } catch {
      return null;
    }
  }

  const input = (ctx: Ctx): NodeCheckInput => ({
    dir: ctx.project.path,
    rootDir: rootDirOf(ctx.project),
    // The lockfile's manager only, as the module's runEnv passes it: both share the check's cache.
    packageManager: lockfileOf(ctx.project),
    lockfiles: nodeOf(ctx.project)?.lockfiles ?? [],
    fnm: ctx.settings.get().fnm,
    platform: ctx.platform,
    onChecked: (state, ms) =>
      deps.logger.info('node check', { projectId: ctx.project.id, state, ms }),
  });

  return defineMainTool({
    ...nodeDefinition,
    contract: nodeContract,
    handlers: {
      status: async (ctx: Ctx) => check.status(input(ctx)),
      refresh: async (ctx: Ctx) => check.refresh(input(ctx)),
      // The switch belongs to the root project; the cache is keyed by it, so every package checks again.
      setFnm: async (ctx: Ctx, { enabled }) => {
        ctx.settings.update((s) => ({ ...s, fnm: enabled }));
        return check.status(input(ctx));
      },
      startAdvice: async (ctx: Ctx): Promise<StartAdvice> => check.advice(input(ctx)),
      fnmInstall: async (ctx: Ctx) => {
        const version = (await check.status(input(ctx))).fixes.fnmInstall;
        if (version === null)
          throw new NestboxError('CONFLICT', 'fnm has nothing to install for this package');
        await ctx.platform.openTerminal(ctx.project.path, `fnm install ${version}`);
        deps.logger.info('node fix', { projectId: ctx.project.id, fix: 'fnm-install' });
      },
      copyNvmCommand: async (ctx: Ctx) => {
        const command = (await check.status(input(ctx))).fixes.nvm;
        if (command === null) throw new NestboxError('CONFLICT', 'No nvm command for this package');
        deps.clipboard.writeText(command);
      },
      createNvmrc: async (ctx: Ctx) => {
        const version = (await check.status(input(ctx))).fixes.nvmrc;
        if (version === null)
          throw new NestboxError('CONFLICT', 'This package already has a version file');
        // null: the file must not exist yet (CONFLICT otherwise), so an existing .nvmrc is never overwritten.
        await versionFiles.write(
          rootDirOf(ctx.project) ?? ctx.project.path,
          '.nvmrc',
          `${version}\n`,
          null,
        );
        deps.logger.info('node fix', { projectId: ctx.project.id, fix: 'create-nvmrc' });
        check.forget();
        return check.status(input(ctx));
      },
    },
    forgetProject() {
      check.forget();
    },
  });
}
