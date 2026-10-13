// The Node tool: which Node version a package needs (version files, engines, Volta), whether the sources agree,
// and whether the Node and package manager that will run its scripts match. The check itself lives in the
// Node module (ecosystems/node/version-check.ts), whose runEnv gives every start the same advice; this tool
// shows it and owns the fnm switch.
import type { DetectedProject } from '@shared/detected';
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
import type { Logger } from '../../logger';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';

export interface NodeToolDeps {
  logger: Logger;
  /** Throws NOT_FOUND for unknown ids (the root project, for inherited sources). */
  getDetected(projectId: string): DetectedProject;
  /** The check, shared with the Node module in the app (its own one by default, for tests). */
  check?: NodeVersionCheck;
}

type Ctx = ToolContext<NodeSettings>;

export function createNodeTool(deps: NodeToolDeps): AnyMainTool {
  const check = deps.check ?? createNodeVersionCheck();

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
    packageManager: ctx.project.packageManager,
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
    },
    forgetProject() {
      check.forget();
    },
  });
}
